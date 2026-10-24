import { describe, expect, it } from "vitest";
import { refreshMetric, validatePublication } from "../src/production/metrics.ts";
import type { MetricRecord } from "../src/production/types.ts";
import { parseCollectOutput } from "../src/collectPublish.ts";
const old: MetricRecord = { platform: "wechat", accountId: "one", remoteId: "abc", url: "https://channels.weixin.qq.com/platform/post/list", checkedAt: 1, syncedAt: 1, views: 100, state: "ok" };
describe("account-scoped metric matching", () => {
  it("associates a collected Douyin work using its exact id and canonical URL", () => {
    const id = "1234567890123456789";
    const collected = parseCollectOutput(JSON.stringify({ collected: [{ platform: "douyin", items: [{ title: "已发表作品", remoteId: id, url: "https://www.iesdouyin.com/share/video/1234567890123456789/?share_sign=tracking&did=device", views: 330, likes: 0, comments: 1 }] }] }));
    const post = collected.collected[0]!.items[0]!;
    expect(post.url).toBe(`https://www.douyin.com/video/${id}`);
    expect(() => validatePublication("douyin", post.remoteId!, post.url)).not.toThrow();
    expect(refreshMetric({ platform: "douyin", accountId: "actual-account", remoteId: id, state: "unassociated", checkedAt: 0 }, [post])).toMatchObject({ state: "ok", remoteId: id, views: 330, likes: 0, comments: 1 });
  });
  it("requires the exact post id even when every post shares a management-page link", () => {
    const result = refreshMetric(old, [{ platform: "wechat", title: "same title", remoteId: "different", url: old.url!, views: 999 }]);
    expect(result.state).toBe("not-found"); expect(result.views).toBe(100); expect(result.syncedAt).toBe(1);
  });
  it("distinguishes a real zero from an unavailable field and retains stale values on failure", () => {
    const result = refreshMetric(old, [{ platform: "wechat", title: "actual", remoteId: "abc", likes: 0 }]);
    expect(result.likes).toBe(0); expect(result.views).toBeUndefined();
    expect(refreshMetric(old, [], "permission denied")).toMatchObject({ state: "error", views: 100, syncedAt: 1 });
  });
  it("rejects ambiguous duplicate evidence and foreign platform links", () => {
    const post = { platform: "wechat" as const, title: "actual", remoteId: "abc", views: 4 };
    expect(refreshMetric(old, [post, post]).state).toBe("not-found");
    expect(() => validatePublication("bilibili", "BV1abc", "https://bilibili.com.evil.example/video")).toThrow("不一致");
    expect(() => validatePublication("bilibili", "BV1abc", "https://www.bilibili.com/video/BV1abc")).not.toThrow();
  });
});
