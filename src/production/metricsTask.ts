import type { ContentDetail, PublishPlatform } from "../types.ts";
import type { CollectedPost } from "../collectPublish.ts";
import { titleScore } from "../collectPublish.ts";
import { refreshMetric } from "./metrics.ts";
import { hashText, locked, readSettings, readState, updateState } from "./storage.ts";
import type { MetricRecord, MetricsProgress, MetricsTarget, ProductionTask } from "./types.ts";
import { safeError } from "./process.ts";
import { browserControlStopped } from "./browser.ts";

export const METRICS_PLATFORM_TIMEOUT_MS = 180_000;
export async function metricsSnapshot(dataDir: string, folder: string, enabled: readonly PublishPlatform[], platform?: MetricsTarget["platform"], publicationId?: string, selection: { recordId?: string; remoteId?: string; expectedAccountId?: string } = {}): Promise<{ metricsTargets: MetricsTarget[]; metricsKey: string }> {
  const settings = await readSettings(dataDir), state = await readState(folder);
  if (platform && platform !== "official-account" && !enabled.includes(platform)) throw new Error("此平台尚未启用。");
  const publication = publicationId ? state.publications?.find((p) => p.id === publicationId && !p.hidden) : undefined;
  if (publicationId && !publication) throw new Error("发布内容不存在。");
  if (publication && platform && publication.platform !== platform) throw new Error("作品与本次平台不符。");
  if (selection.recordId && !state.records?.some(r => r.id === selection.recordId && (!publicationId || r.publicationId === publicationId) && (!platform || r.platform === platform))) throw new Error("作品记录不属于本次材料或平台。");
  const platforms = platform ? [platform] : publication ? [publication.platform] : enabled.filter((p) => Boolean(settings.accounts[p]));
  const targets: MetricsTarget[] = platforms.flatMap((p) => {
    const accountId = p === "official-account" ? settings.wechat.appid : settings.accounts[p]?.id;
    if (!accountId) throw new Error("请先连接对应的平台账号。");
    if (selection.expectedAccountId && selection.expectedAccountId !== accountId) throw new Error("平台账号已变化，请重新选择当前作品。");
    const rows = state.metrics.filter((m) => m.platform === p && m.accountId === accountId && (!publicationId || m.publicationId === publicationId) && (!selection.recordId || m.recordId === selection.recordId) && (!selection.remoteId || m.remoteId === selection.remoteId));
    if(selection.recordId && !rows.length) {
      const record=state.records?.find(r=>r.id===selection.recordId&&r.platform===p&&r.accountId===accountId&&(!publicationId||r.publicationId===publicationId));
      if(!record) throw new Error("此作品属于其他账号或尚未关联数据。");
      if(!record.remoteId) throw new Error("此上传记录尚无作品标识，请先关联已发表作品。");
      return [{platform:p,accountId,recordId:record.id,publicationId:record.publicationId,remoteId:record.remoteId,...(record.url?{url:record.url}:{})}];
    }
    if (selection.remoteId && !rows.length) throw new Error("此作品属于其他账号或尚未关联数据。");
    return rows.length ? rows.map((row) => ({ platform: p, accountId, remoteId: row.remoteId, ...(row.url ? { url: row.url } : {}), ...(row.publicationId ? { publicationId: row.publicationId } : {}), ...(row.recordId ? { recordId: row.recordId } : {}) })) : [{ platform: p, accountId, ...(publicationId ? { publicationId } : {}) }];
  });
  if (!targets.length) throw new Error("请先连接发布平台账号。");
  targets.sort((a, b) => `${a.platform}:${a.publicationId ?? ""}:${a.remoteId ?? ""}`.localeCompare(`${b.platform}:${b.publicationId ?? ""}:${b.remoteId ?? ""}`));
  return { metricsTargets: targets, metricsKey: hashText(JSON.stringify(targets)) };
}

/** Deadline includes login checks and scraping. Every write rechecks identity and cancellation. */
export async function runMetricsTask(input: {
  dataDir: string; folder: string; task: ProductionTask; signal: AbortSignal;
  detail: ContentDetail; timeoutMs?: number;
  collect: (target: MetricsTarget, signal: AbortSignal) => Promise<CollectedPost[]>;
  published?: (record: MetricRecord) => Promise<void>;
  changed: () => void;
}): Promise<void> {
  const { folder, task, signal } = input, progress: MetricsProgress[] = (task.metricsTargets ?? []).map((row) => ({ ...row, state: "queued" }));
  const patch = async () => { await updateState(folder, (state) => { const row = state.tasks.find((t) => t.id === task.id)!; row.metricsProgress = structuredClone(progress); row.updatedAt = Date.now(); }); input.changed(); };
  const checkAccount = async (target: MetricsTarget) => {
    const settings = await readSettings(input.dataDir), actual = target.platform === "official-account" ? settings.wechat.appid : settings.accounts[target.platform]?.id;
    if (actual !== target.accountId) throw new Error("平台账号已变化，本次结果未写回。请用当前账号重新同步。");
  };
  let stopped = false;
  const platformReads = new Map<string, Promise<CollectedPost[]>>(), platformStarts = new Map<string, number>();
  for (const target of progress) {
    if (signal.aborted || stopped) { target.state = "cancelled"; target.endedAt = Date.now(); continue; }
    target.state = "running"; target.startedAt = Date.now(); await patch();
    const deadline = new AbortController(), current = AbortSignal.any([signal, deadline.signal]);
    const platformKey = `${target.platform}:${target.accountId}`, started = platformStarts.get(platformKey) ?? Date.now(); platformStarts.set(platformKey, started);
    const timer = setTimeout(() => deadline.abort(new Error("同步超过 180 秒，已停止本次平台操作。")), Math.max(1, (input.timeoutMs ?? METRICS_PLATFORM_TIMEOUT_MS) - (Date.now() - started)));
    try {
      await checkAccount(target);
      let reading = platformReads.get(platformKey); if (!reading) { reading = input.collect(target, current); platformReads.set(platformKey, reading); }
      const posts = await Promise.race([reading, new Promise<never>((_, reject) => { if (current.aborted) reject(current.reason); else current.addEventListener("abort", () => reject(current.reason), { once: true }); })]);
      current.throwIfAborted();
      await locked(`settings:${input.dataDir}`, async () => {
        await checkAccount(target); current.throwIfAborted();
        let published: MetricRecord | undefined, matchError: string | undefined;
        await updateState(folder, (state) => {
          const owner = state.tasks.find((t) => t.id === task.id);
          if (!owner || !["running", "queued"].includes(owner.status)) throw new Error("任务已停止，结果未写回。");
          if (target.remoteId) {
            let index = state.metrics.findIndex((m) => m.platform === target.platform && m.accountId === target.accountId && m.remoteId === target.remoteId && m.publicationId === target.publicationId && m.recordId === target.recordId);
            if(index < 0 && target.recordId) {
              const record=state.records?.find(r=>r.id===target.recordId&&r.platform===target.platform&&r.accountId===target.accountId&&r.publicationId===target.publicationId&&r.remoteId===target.remoteId);
              if(record){index=state.metrics.length;state.metrics.push({platform:target.platform,accountId:target.accountId,remoteId:target.remoteId,publicationId:record.publicationId,recordId:record.id,state:"unassociated",checkedAt:Date.now(),...(record.url?{url:record.url}:{})});}
            }
            if (index < 0) throw new Error("作品关联已变化，本次结果未写回。");
            const next = refreshMetric(state.metrics[index]!, posts); state.metrics[index] = next;
            if (next.state !== "ok") matchError = next.error; else {
              published = next;
              for (const record of state.records ?? []) if (record.platform === next.platform && record.accountId === next.accountId && (next.recordId ? record.id === next.recordId : next.publicationId && record.publicationId === next.publicationId && record.remoteId === next.remoteId)) { record.state = "published"; record.remoteId = next.remoteId; if (next.url) record.url = next.url; record.updatedAt = Date.now(); }
            }
          } else {
            const candidates = posts.filter((post) => post.remoteId).sort((a, b) => titleScore(input.detail.title, b.title) - titleScore(input.detail.title, a.title)).slice(0, 10).map((post) => ({ platform: target.platform, accountId: target.accountId, remoteId: post.remoteId!, title: post.title, ...(post.url ? { url: post.url } : {}) }));
            state.candidates = [...(state.candidates ?? []).filter((row) => row.platform !== target.platform || row.accountId !== target.accountId), ...candidates];
          }
        });
        if (matchError) throw new Error(matchError);
        if (published) { current.throwIfAborted(); await input.published?.(published); }
      });
      target.state = "completed";
    } catch (error) {
      target.error = safeError(error);
      target.state = signal.aborted ? "cancelled" : browserControlStopped(error) ? "blocked" : "failed";
      if (target.state === "blocked" || deadline.signal.aborted) stopped = true;
      // Failed collection retains last good values, with an explicit failed check.
      await updateState(folder, (state) => { const row = state.metrics.find((m) => m.platform === target.platform && m.accountId === target.accountId && m.remoteId === target.remoteId && m.publicationId === target.publicationId && m.recordId === target.recordId); if (row) { if (row.state !== "not-found") row.state = "error"; row.error = target.error!; row.checkedAt = Date.now(); } });
    } finally { clearTimeout(timer); target.endedAt = Date.now(); await patch(); }
  }
  await updateState(folder, (state) => {
    const owner = state.tasks.find((t) => t.id === task.id)!;
    owner.metricsProgress = progress;
    owner.status = signal.aborted ? "cancelled" : progress.some((p) => p.state === "blocked") ? "blocked" : progress.some((p) => p.state === "failed") ? "failed" : "completed";
    owner.step = progress.some((p) => !p.remoteId && p.state === "completed") ? "待关联作品：选择准确作品后即会读取数据。" : "同步已结束";
    const errors = progress.filter((p) => p.error).map((p) => `${p.platform}：${p.error}`);
    if (errors.length) owner.error = errors.join("；"); else delete owner.error;
    owner.updatedAt = Date.now();
  }); input.changed();
}
