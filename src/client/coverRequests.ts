import type { ContentDetail } from "../types.ts";
import type { CoverAction, CoverRatio, CoverState } from "../covers/types.ts";
import { prepareBusinessRequest } from "./workbench.ts";

/** A request is admitted only after session/draft preflight; rollback is limited to this new request. */
export async function prepareCoverRequest(ctx: { get: (name: string) => unknown }, detail: ContentDetail, ratios: CoverRatio[], action: (request: CoverAction) => Promise<CoverState>, append = false): Promise<void> {
  if (!detail.selectedVideo) throw new Error("请先选择当前视频。");
  const requestToken = crypto.randomUUID(); let freshRun: string | undefined, runId: string | undefined, owner: string | undefined;
  const scope = { id: detail.id, folderPath: detail.folderPath };
  try {
    await prepareBusinessRequest(ctx, detail, async (sessionId) => {
      owner = sessionId;
      const state = await action({ ...scope, action: "create", video: detail.selectedVideo!, ratios, requestToken });
      const run = [...state.runs].reverse().find((row) => (row.purpose ?? "cover") === "cover" && row.video.name === detail.selectedVideo && ["waiting_agent", "preparing", "running"].includes(row.status));
      if (!run) throw new Error("封面请求未建立。"); runId = run.id;
      if (run.requestToken === requestToken) freshRun = run.id;
      return `请为本期视频制作 ${ratios.map((ratio) => ratio.replace("x", ":")).join("、")} 封面。调用 creator_prepare_cover 阅读真实画面和规则，再完成生成、看图检查和选用。\n制作请求：${JSON.stringify({ ...scope, runId: run.id })}`;
    }, async () => detail.folderPath, append, "制作请求");
  } catch (error) {
    if (freshRun) await action({ ...scope, action: "discard-request", runId: freshRun, requestToken });
    throw error;
  }
  if (runId && owner) await action({ ...scope, action: "delivered", runId, sessionId: owner });
}
