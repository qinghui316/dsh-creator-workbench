import type { CollectedPost } from "../collectPublish.ts";
import type { MetricRecord } from "./types.ts";

export function refreshMetric(previous: MetricRecord, posts: readonly CollectedPost[], error?: string): MetricRecord {
  const checkedAt = Date.now();
  if (error) return { ...previous, checkedAt, state: "error", error };
  const matches = posts.filter((post) => post.remoteId === previous.remoteId);
  if (matches.length !== 1) return { ...previous, checkedAt, state: "not-found", error: matches.length > 1 ? "存在多个匹配结果，请核对平台链接。" : "当前账号中未找到这条内容，请核对链接或发表状态。" };
  const post = matches[0]!;
  const result: MetricRecord = { platform: previous.platform, accountId: previous.accountId, remoteId: previous.remoteId, checkedAt, syncedAt: checkedAt, state: "ok", ...(post.url ?? previous.url ? { url: post.url ?? previous.url! } : {}) };
  for (const key of ["views", "likes", "comments"] as const) { const value = post[key]; if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value; }
  return result;
}
export function validatePublication(platform: MetricRecord["platform"], remoteId: string, url?: string): void {
  if (!remoteId.trim() || remoteId.length > 200 || /[\s\x00-\x1f]/.test(remoteId)) throw new Error("请填写有效的平台内容标识。");
  if (url) {
    let parsed: URL; try { parsed = new URL(url); } catch { throw new Error("请填写完整的内容链接。"); }
    const domains = { xiaohongshu: ["xiaohongshu.com", "xhslink.com"], douyin: ["douyin.com"], bilibili: ["bilibili.com", "b23.tv"], wechat: ["channels.weixin.qq.com"], "official-account": ["mp.weixin.qq.com"] }[platform];
    if (parsed.protocol !== "https:" || !domains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) throw new Error("内容链接与所选平台不一致。");
  }
}
