import { randomUUID } from "node:crypto";
import { validatePublication } from "./metrics.ts";
import { locked, readSettings, updateState } from "./storage.ts";
import { isActiveTask, type ProductionAction } from "./types.ts";

type Association = Extract<ProductionAction, { action: "associate-publication" }>;

/** The initiating account remains fixed through the entire local association write. */
export async function associatePublication(dataDir: string, folder: string, request: Association, assertAvailable: () => Promise<unknown>): Promise<string | undefined> {
  validatePublication(request.platform, request.remoteId, request.url);
  if (!request.expectedAccountId) throw new Error("请重新打开作品关联，确认当前平台账号后再保存。");
  return locked(`settings:${dataDir}`, async () => {
    const settings = await readSettings(dataDir);
    const accountId = request.platform === "official-account" ? settings.wechat.appid : settings.accounts[request.platform]?.id;
    if (!accountId) throw new Error("请先连接对应账号。");
    if (accountId !== request.expectedAccountId || request.candidateAccountId && request.candidateAccountId !== accountId) throw new Error("平台账号已变化，原作品未关联。请用当前账号重新选择。");
    return updateState(folder, async state => {
      await assertAvailable();
      if (state.tasks.some(t => t.kind === "metrics" && isActiveTask(t))) throw new Error("正在同步，请等待或取消原任务后再更换作品关联。");
      const remoteId = request.remoteId.trim();
      if (request.candidateAccountId && !state.candidates?.some(c => c.platform === request.platform && c.accountId === accountId && c.remoteId === remoteId)) throw new Error("候选作品已变化，请重新选择或手工填写作品标识。");
      const publication = request.publicationId ? state.publications?.find(p => p.id === request.publicationId && !p.hidden) : undefined;
      if (request.publicationId && (!publication || publication.platform !== request.platform)) throw new Error("作品关联与发布内容的平台不符。");
      let recordId = request.recordId;
      if (recordId && !state.records?.some(r => r.id === recordId && r.publicationId === request.publicationId && r.platform === request.platform && r.accountId === accountId)) throw new Error("作品记录不属于本次发布内容或账号。");
      if (publication && !recordId) {
        const records = state.records ??= [];
        const old = records.find(r => r.publicationId === publication.id && r.platform === request.platform && r.accountId === accountId && r.remoteId === remoteId);
        recordId = old?.id ?? randomUUID();
        if (!old) records.push({ id: recordId, publicationId: publication.id, revision: publication.revision, platform: publication.platform, type: publication.type, accountId, remoteId, ...(request.url ? { url: request.url } : {}), state: "linked", updatedAt: Date.now() });
      }
      if (request.recordId) {
        const record = state.records!.find(r => r.id === request.recordId)!;
        record.remoteId = remoteId; record.state = "linked"; record.updatedAt = Date.now();
        if (request.url) record.url = request.url; else delete record.url;
      }
      const old = state.metrics.find(m => m.platform === request.platform && m.accountId === accountId && (recordId ? m.recordId === recordId : request.publicationId ? m.publicationId === request.publicationId : !m.publicationId));
      if (old && old.remoteId !== remoteId) {
        old.remoteId = remoteId; old.state = "unassociated";
        delete old.syncedAt; delete old.views; delete old.likes; delete old.comments; delete old.shares;
      }
      if (old) { if (request.url) old.url = request.url; else delete old.url; }
      else state.metrics.push({ ...(request.publicationId ? { publicationId: request.publicationId } : {}), ...(recordId ? { recordId } : {}), platform: request.platform, accountId, remoteId, ...(request.url ? { url: request.url } : {}), checkedAt: Date.now(), state: "unassociated" });
      return recordId;
    });
  });
}
