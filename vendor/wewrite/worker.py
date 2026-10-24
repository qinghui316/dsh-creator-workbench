"""Workbench JSON worker. Credentials enter only via private stdin; output is allowlisted."""
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib.parse import unquote

import requests
import yaml
from bs4 import BeautifulSoup
from converter import WeChatConverter as UpstreamConverter, preview_html
from theme import load_theme


class WeChatConverter(UpstreamConverter):
    def _fix_cjk_spacing(self, text):
        # Keep the reused typography pass from inserting spaces into local image/link URLs.
        # The upstream converter stays unchanged, so its snapshot is independently verifiable.
        protected = {}
        prefix = "WEWRITEREFERENCE" + hashlib.sha256(text.encode("utf-8")).hexdigest()

        def preserve(value):
            key = prefix + str(len(protected)) + "END"
            protected[key] = value
            return key

        text = re.sub(r"(\]\()([^\n)]*)(\))", lambda m: m[1] + preserve(m[2]) + m[3], text)
        text = re.sub(r"(\b(?:src|href)\s*=\s*)([\"'])(.*?)(\2)", lambda m: m[1] + m[2] + preserve(m[3]) + m[4], text)
        text = super()._fix_cjk_spacing(text)
        for key, value in reversed(list(protected.items())):
            text = text.replace(key, value)
        return text


class ApiError(Exception):
    def __init__(self, message, code=None, unknown=False):
        super().__init__(message)
        self.code, self.unknown = code, unknown


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def api(path, token=None, body=None, files=None, params=None):
    query = dict(params or {})
    if token:
        query["access_token"] = token
    try:
        answer = requests.request(
            "POST" if body is not None or files else "GET",
            "https://api.weixin.qq.com/" + path,
            params=query, files=files,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None,
            headers={"Content-Type": "application/json; charset=utf-8"} if body is not None else {},
            timeout=(10, 90), allow_redirects=False,
        )
        answer.raise_for_status()
        value = answer.json()
    except requests.RequestException:
        raise ApiError("公众号连接中断，请核对本次操作结果。", unknown=body is not None or files is not None)
    except ValueError:
        raise ApiError("公众号返回结果无法读取。", unknown=body is not None or files is not None)
    if value.get("errcode", 0):
        code = value["errcode"]
        hints = {40164: "请把当前出口 IP 加入公众号后台 IP 白名单。", 40001: "公众号凭据或访问令牌无效。", 40125: "公众号 AppSecret 无效。", 48001: "公众号尚未授权此接口。", 45009: "公众号接口调用额度已用尽。", 61500: "所选日期暂无公众号数据。"}
        raise ApiError(hints.get(code, "公众号操作失败，请检查接口权限或后台状态。"), code=code)
    return value


def token_for(config):
    if not config.get("appid") or not config.get("secret"):
        raise ApiError("请先配置公众号 AppID 和 AppSecret。")
    value = api("cgi-bin/token", params={"grant_type": "client_credential", "appid": config["appid"], "secret": config["secret"]})
    if not value.get("access_token"):
        raise ApiError("公众号未返回可用访问令牌。")
    return value["access_token"]


def local_file(folder, article, reference):
    if re.match(r"^(?:https?:|data:|file:|//)", reference, re.I):
        raise ApiError("正文图片需保存到本期目录后再准备草稿。")
    file = (article.parent / unquote(reference.split("?")[0])).resolve()
    root = folder.resolve()
    if root not in file.parents or not file.is_file():
        raise ApiError("正文图片缺失或超出本期目录：" + reference[:180])
    if file.stat().st_size > 24 * 1024 * 1024:
        raise ApiError("正文图片超过 24 MB：" + file.name)
    return file


def render(config):
    folder, article = Path(config["folder"]).resolve(), Path(config["article"]).resolve()
    if folder not in article.parents or not article.is_file():
        raise ApiError("文章不在当前内容目录中。")
    theme_name = config.get("theme", "claude-editorial")
    if theme_name not in {"claude-editorial", "professional-clean"}:
        raise ApiError("所选排版主题不可用。")
    theme = load_theme(theme_name)
    result = WeChatConverter(theme=theme).convert(config.get("markdown") if "markdown" in config else article.read_text(encoding="utf-8-sig"))
    if not result.title.strip():
        raise ApiError("请在文章第一行填写一级标题。")
    soup = BeautifulSoup(result.html, "html.parser")
    for tag in soup.find_all(["script", "iframe", "object", "embed", "form"]):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.lower().startswith("on"):
                del tag[attr]
    images = []
    for img in soup.find_all("img"):
        source = str(img.get("src", ""))
        file = local_file(folder, article, source)
        images.append({"source": source, "path": str(file), "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    html = str(soup)
    preview = preview_html("<h1>" + escape(result.title) + "</h1>\n" + html, theme)
    preview = preview.replace("<title>Preview</title>", "<title>" + escape(result.title) + "</title>")
    return {"title": result.title, "digest": result.digest, "html": html, "preview": preview, "images": images}


def atomic(path, value):
    path = Path(path)
    temp = path.with_name(path.name + ".worker.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def draft_article(token, media_id):
    value = api("cgi-bin/draft/get", token, {"media_id": media_id})
    items = value.get("news_item", [])
    if len(items) != 1:
        raise ApiError("目标草稿不是本工作台创建的单篇文章，请核对。")
    return items[0]


def remote_digest(article):
    return digest(article.get("title", "") + "\n" + article.get("content", ""))


def submission_identity(article):
    soup = BeautifulSoup(article.get("content", ""), "html.parser")
    return {"title": article.get("title", ""), "text": soup.get_text("", strip=True), "images": [img.get("src") for img in soup.find_all("img")]}


def inspect_draft(config):
    folder = Path(config["folder"]).resolve()
    receipt_path = Path(config["receiptPath"]).resolve()
    if folder not in receipt_path.parents:
        raise ApiError("草稿回执目录无效。")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {}
    if receipt and receipt.get("appid") != config["appid"]:
        raise ApiError("草稿回执属于另一公众号。")
    media_id = receipt.get("mediaId") or config.get("mediaId")
    if not media_id or not (receipt.get("expected") or config.get("remoteHash")):
        raise ApiError("缺少可核对的草稿回执，请先检查公众号后台；未重新提交。", unknown=True)
    actual = draft_article(token_for(config), media_id)
    matches = (submission_identity(actual) == receipt["expected"] if receipt.get("expected")
               else remote_digest(actual) == config["remoteHash"])
    if not matches:
        raise ApiError("公众号草稿内容与提交记录不同，请核对后台修改。", code="DRAFT_CONFLICT")
    receipt.update(appid=config["appid"], mediaId=media_id, remoteHash=remote_digest(actual), phase="verified")
    atomic(receipt_path, receipt)
    return {"mediaId": media_id, "remoteHash": receipt["remoteHash"], "title": actual.get("title", "")}


def publish(config):
    rendered = render(config)
    cover = Path(config.get("cover", "")).resolve()
    folder = Path(config["folder"]).resolve()
    if folder not in cover.parents or not cover.is_file():
        raise ApiError("请先选择保存在本期目录内的公众号封面。")
    receipt_path = Path(config["receiptPath"]).resolve()
    if folder not in receipt_path.parents:
        raise ApiError("草稿回执目录无效。")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {}
    if receipt and receipt.get("appid") != config["appid"]:
        raise ApiError("草稿回执属于另一公众号。")
    token = token_for(config)
    media_id = config.get("mediaId") or receipt.get("mediaId")
    previous_hash = config.get("remoteHash") or receipt.get("remoteHash")
    if media_id:
        existing = draft_article(token, media_id)
        if receipt.get("phase") == "submitted" and receipt.get("expected"):
            if submission_identity(existing) == receipt["expected"]:
                receipt.update(remoteHash=remote_digest(existing), phase="verified")
                atomic(receipt_path, receipt)
                return {"mediaId": media_id, "remoteHash": receipt["remoteHash"], "title": existing.get("title", "")}
            if not config.get("confirmRemoteChange"):
                raise ApiError("已提交的草稿内容需要核对，请检查后台修改后再明确更新。", code="DRAFT_CONFLICT")
        if previous_hash and remote_digest(existing) != previous_hash and not config.get("confirmRemoteChange"):
            raise ApiError("公众号草稿已在后台修改，请核对后明确选择覆盖。", code="DRAFT_CONFLICT")
    soup = BeautifulSoup(rendered["html"], "html.parser")
    uploaded = receipt.get("images", {})
    for image in rendered["images"]:
        key = image["sha256"]
        if key not in uploaded:
            file = Path(image["path"])
            image_bytes = file.read_bytes()
            if hashlib.sha256(image_bytes).hexdigest() != key:
                raise ApiError("正文图片在准备过程中发生变化，请重新准备。")
            result = api("cgi-bin/media/uploadimg", token, files={"media": (file.name, io.BytesIO(image_bytes))})
            if not str(result.get("url", "")).startswith(("https://", "http://")):
                raise ApiError("正文图片上传未返回有效地址。")
            uploaded[key] = result["url"]
            receipt.update(appid=config["appid"], images=uploaded)
            atomic(receipt_path, receipt)
        for img in soup.find_all("img", src=image["source"]):
            img["src"] = uploaded[key]
    cover_bytes = cover.read_bytes()
    cover_hash = hashlib.sha256(cover_bytes).hexdigest()
    if receipt.get("coverHash") != cover_hash or not receipt.get("thumbId"):
        thumb = api("cgi-bin/material/add_material", token, files={"media": (cover.name, io.BytesIO(cover_bytes))}, params={"type": "image"})
        if not thumb.get("media_id"):
            raise ApiError("公众号封面上传没有返回资源标识。")
        receipt.update(appid=config["appid"], coverHash=cover_hash, thumbId=thumb["media_id"])
        atomic(receipt_path, receipt)
    article = {"title": rendered["title"], "author": config.get("author", ""), "digest": rendered["digest"], "content": str(soup), "thumb_media_id": receipt["thumbId"], "show_cover_pic": 0}
    receipt.update(expected=submission_identity(article))
    atomic(receipt_path, receipt)
    if media_id:
        api("cgi-bin/draft/update", token, {"media_id": media_id, "index": 0, "articles": article})
    else:
        result = api("cgi-bin/draft/add", token, {"articles": [article]})
        media_id = result.get("media_id")
        if not media_id:
            raise ApiError("草稿创建结果未确认，未返回草稿标识。", unknown=True)
    receipt.update(appid=config["appid"], mediaId=media_id, phase="submitted")
    atomic(receipt_path, receipt)
    actual = draft_article(token, media_id)
    expected_text = BeautifulSoup(article["content"], "html.parser").get_text("", strip=True)
    actual_text = BeautifulSoup(actual.get("content", ""), "html.parser").get_text("", strip=True)
    expected_images = [img.get("src") for img in soup.find_all("img")]
    actual_images = [img.get("src") for img in BeautifulSoup(actual.get("content", ""), "html.parser").find_all("img")]
    if actual.get("title") != article["title"] or expected_text != actual_text or expected_images != actual_images:
        raise ApiError("草稿已提交，但读取内容与本次文章不一致，请在后台核对。", unknown=True)
    receipt.update(remoteHash=remote_digest(actual), phase="verified")
    atomic(receipt_path, receipt)
    return {"mediaId": media_id, "remoteHash": receipt["remoteHash"], "title": article["title"], "html": actual["content"]}


def stats(config):
    token, rows = token_for(config), []
    today = datetime.now(timezone(timedelta(hours=8))).date()
    for offset in range(1, 8):
        day = str(today - timedelta(days=offset))
        try:
            result = api("datacube/getarticletotal", token, {"begin_date": day, "end_date": day})
        except ApiError as error:
            if error.code == 61500:
                continue
            raise
        for item in result.get("list", []):
            details = item.get("details", [])
            latest = sorted(details, key=lambda row: row.get("stat_date", ""))[-1] if details else {}
            row = {"remoteId": str(item.get("msgid", "")), "date": item.get("ref_date", day), "title": str(item.get("title", ""))}
            for target, source in [("views", "int_page_read_count"), ("likes", "like_count"), ("shares", "share_count")]:
                if isinstance(latest.get(source), (int, float)):
                    row[target] = latest[source]
            if row["remoteId"]:
                rows.append(row)
    return {"rows": rows, "window": "最近七天发表文章的累计数据"}


def main(config):
    operation = config["operation"]
    if operation == "import-config":
        value = yaml.safe_load(Path(config["path"]).read_text(encoding="utf-8-sig")) or {}
        account = value.get("wechat", {})
        if not account.get("appid") or not account.get("secret"):
            raise ApiError("配置文件缺少公众号 AppID 或 AppSecret。")
        return {"appid": str(account["appid"]), "secret": str(account["secret"]), "author": str(account.get("author", ""))}
    if operation == "render":
        return render(config)
    if operation == "check":
        token_for(config)
        return {"authenticated": True, "draftPermission": "待实际草稿操作验证", "metricsPermission": "待实际数据回收验证"}
    if operation == "publish":
        return publish(config)
    if operation == "inspect":
        return inspect_draft(config)
    if operation == "stats":
        return stats(config)
    raise ApiError("不支持的公众号操作。")


if __name__ == "__main__":
    try:
        config = json.load(sys.stdin)
        result = main(config)
        print(json.dumps({"ok": True, "value": result}, ensure_ascii=False))
    except ApiError as error:
        print(json.dumps({"ok": False, "error": str(error), "code": error.code, "unknown": error.unknown}, ensure_ascii=False))
        sys.exit(1)
    except Exception:
        # Never print requests exception URLs, token-bearing input or tracebacks.
        print(json.dumps({"ok": False, "error": "公众号操作未完成，请检查依赖、文件或后台状态。", "unknown": True}, ensure_ascii=False))
        sys.exit(1)
