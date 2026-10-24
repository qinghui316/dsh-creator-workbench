"""Offline protocol tests: all official-account requests are replaced with fixtures."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "vendor" / "wewrite"))
spec = importlib.util.spec_from_file_location("worker", root / "vendor" / "wewrite" / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

with tempfile.TemporaryDirectory(prefix="creator-wechat-protocol-") as temp:
    folder = Path(temp)
    article = folder / "article.md"
    article.write_text("# 测试文章\n\n实际正文内容。\n\n<script>alert('unsafe')</script>\n", encoding="utf-8")
    cover = folder / "cover.png"
    cover.write_bytes(b"fixture image bytes")
    config = dict(folder=str(folder), article=str(article), cover=str(cover), appid="wxfixture00000001", secret="fixture-secret", author="Tester", theme="claude-editorial", receiptPath=str(folder / "receipt.json"))
    rendered = worker.render(config)
    assert "<script" not in rendered["html"]
    assert rendered["title"] == "测试文章"

    remote, calls, fail_read = {}, [], [True]
    def fake_api(path, token=None, body=None, files=None, params=None):
        calls.append(path)
        if path == "cgi-bin/token": return {"access_token": "fixture-token"}
        if path == "cgi-bin/material/add_material": return {"media_id": "thumb-one"}
        if path == "cgi-bin/draft/add":
            remote.update(body["articles"][0])
            return {"media_id": "draft-one"}
        if path == "cgi-bin/draft/update":
            remote.clear()
            remote.update(body["articles"])
            return {"errcode": 0}
        if path == "cgi-bin/draft/get":
            if fail_read[0]:
                fail_read[0] = False
                raise worker.ApiError("fixture read interruption", unknown=True)
            return {"news_item": [dict(remote)]}
        raise AssertionError("Unexpected external request: " + path)
    worker.api = fake_api
    try:
        worker.publish(config)
        raise AssertionError("Expected interrupted readback")
    except worker.ApiError as error:
        assert error.unknown
    receipt = json.loads(Path(config["receiptPath"]).read_text(encoding="utf-8"))
    assert receipt["mediaId"] == "draft-one" and receipt["phase"] == "submitted"
    result = worker.publish(config)
    assert result["mediaId"] == "draft-one"
    assert calls.count("cgi-bin/draft/add") == 1
    assert calls.count("cgi-bin/draft/update") == 0

    remote["content"] = "<p>Remote editor changes</p>"
    try:
        worker.publish(config)
        raise AssertionError("Expected remote conflict")
    except worker.ApiError as error:
        assert error.code == "DRAFT_CONFLICT"
    assert calls.count("cgi-bin/draft/update") == 0
    config["confirmRemoteChange"] = True
    result = worker.publish(config)
    assert result["mediaId"] == "draft-one"
    assert calls.count("cgi-bin/draft/add") == 1
    assert calls.count("cgi-bin/draft/update") == 1

    article.write_text("# Missing resource\n\n![image](../outside.png)\n", encoding="utf-8")
    try:
        worker.render(config)
        raise AssertionError("Expected resource boundary failure")
    except worker.ApiError:
        pass

print(json.dumps({"ok": True, "checks": ["render", "sanitize", "resource-boundary", "persisted-media-id", "readback-recovery-no-duplicate", "remote-conflict", "explicit-update"]}))
