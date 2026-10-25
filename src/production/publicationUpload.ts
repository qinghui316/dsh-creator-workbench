import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { creationImage } from "./creations.ts";
import { atomic, hashFile, hashText, inside, mediaIdentity, owned, readSettings, readState, updateState, wechatCredential } from "./storage.ts";
import { sameMedia } from "./types.ts";
import { makeUploadPackage, releaseUploadBrowser, runUpload } from "./publishing.ts";
import { browserExecutable, resource } from "./runtime.ts";
import { BrowserControlError, requireAccount, withBrowser } from "./browser.ts";
import { runProcess } from "./process.ts";
import { submitWechat } from "./wechat.ts";
import { publicationArticleForRender, snapshotPublicationArticle } from "./publicationArticle.ts";
import { formatArticle } from "./articlePreview.ts";
import type { ContentScope, MediaIdentity, PlatformAccount, ProductionTask, PublicationDraft, PublicationRecord, UploadNotice } from "./types.ts";
import type { PublishPlatform } from "../types.ts";

export interface PublicationSnapshot {
  publication: PublicationDraft; body: string; accountId: string; video?: MediaIdentity;
  images: Array<{ file: string; sha256: string; width: number; height: number }>;
  cover?: string; sourceKey: string; articleFile?: string;
}
interface UploadHost { dataDir: string; platforms: () => Promise<readonly PublishPlatform[]>; key: (ref: string) => Promise<string | undefined>; resolve: (scope: ContentScope) => Promise<unknown>; changed: () => void; reserve: (id: string) => void }
export async function preparePublicationUpload(scope: ContentScope, id: string, revision: number, rights: boolean, host: UploadHost, signal: AbortSignal, after?: string, expectedAccountId?: string): Promise<{ task: ProductionTask; fresh: boolean; notice?: UploadNotice }> {
  if (!rights) throw new Error("请先确认本次内容拥有发布授权。");
  const state = await readState(scope.folderPath), publication = state.publications?.find((p) => p.id === id && !p.hidden);
  if (!publication || publication.revision !== revision) throw new Error("发布内容已变化，请重新查看本次材料。");
  if (!publication.title.trim()) throw new Error("请填写本次发布标题后再上传。");
  if (publication.type === "images" && publication.coverImageId && publication.imageIds[0] !== publication.coverImageId) throw new Error("图文封面与第一张图片不一致，请重新保存材料后上传。");
  if (publication.platform === "wechat" && publication.type !== "video") throw new Error("视频号暂不支持图文。");
  if (publication.platform !== "official-account" && !(await host.platforms()).includes(publication.platform)) throw new Error("请先启用此发布平台。");
  const settings = await readSettings(host.dataDir), account = publication.platform === "official-account" ? undefined : settings.accounts[publication.platform];
  const accountId = publication.platform === "official-account" ? settings.wechat.appid : account?.id;
  if (!accountId) throw new Error("请先连接对应的发布账号。");
  if (expectedAccountId && accountId !== expectedAccountId) throw new Error("发布账号已变化，请核对当前账号后再上传。");
  const images = await Promise.all(publication.imageIds.map(async (imageId) => { const { image } = await creationImage(scope.folderPath, imageId, state); return { file: image.file, sha256: image.sha256, width: image.width, height: image.height }; }));
  if (publication.type === "images" && !images.length) throw new Error("请至少选择一张发布图片。");
  const body = await readFile(await inside(scope.folderPath, publication.bodyFile), "utf8");
  const video = publication.type === "video" && publication.video ? await mediaIdentity(await inside(scope.folderPath, publication.video), signal) : undefined;
  if (publication.type === "video" && !video) throw new Error("请明确选择本次发布的视频。");
  const cover = publication.coverImageId ? (await creationImage(scope.folderPath, publication.coverImageId, state)).image.file : undefined;
  if (publication.platform === "official-account" && !cover) throw new Error("请明确选择本次公众号文章封面。");
  const sourceKey = hashText(JSON.stringify({ type: publication.type, video: video?.sha256, images: images.map((i) => i.sha256), articleId: publication.articleId ?? publication.articleFile }));
  const snapshot: PublicationSnapshot = { publication: structuredClone(publication), body, accountId, images, sourceKey, ...(cover ? { cover } : {}), ...(video ? { video } : {}) };
  if(snapshot.publication.category?.trim()) snapshot.publication.category=snapshot.publication.category.trim();
  else delete snapshot.publication.category;
  const key = hashText(JSON.stringify(snapshot));
  return updateState(scope.folderPath, async (latest) => {
    await host.resolve(scope);
    const actual = latest.publications?.find((p) => p.id === id && !p.hidden); if (actual?.revision !== revision) throw new Error("材料正在修改，请重新确认后上传。");
    const candidates = latest.tasks.filter((t) => t.kind === "upload" && (t.account?.id ?? t.wechatAppId) === accountId && (t.platform ?? "official-account") === publication.platform && (video && t.video ? sameMedia(t.video, video) : t.publicationId && t.publicationType === publication.type && (t.publicationId === id || t.source?.text === sourceKey)));
    const previous = after ? candidates.at(-1) : [...candidates].reverse().find((t) => t.uploadKey === key) ?? candidates.at(-1);
    if (after && !candidates.some((t) => t.id === after)) throw new Error("原任务与当前平台、账号或材料不符。");
    if (previous && (!after || previous.id !== after || ["queued", "running"].includes(previous.status))) return { task: structuredClone(previous), fresh: false, notice: { taskId: previous.id, canCreateNew: !["queued", "running"].includes(previous.status), message: "已有上传记录，请检查或继续原任务；需要另一份时明确另建。" } };
    const task: ProductionTask = { id: randomUUID(), kind: "upload", status: "queued", contentId: scope.id, folderPath: scope.folderPath, createdAt: Date.now(), updatedAt: Date.now(), publicationId: id, publicationRevision: revision, publicationType: publication.type, uploadKey: key, source: { kind: "materials", text: sourceKey }, originalRightsConfirmed: true, ...(account ? { account, platform: account.platform } : { wechatAppId: accountId }), ...(video ? { video } : {}) };
    const dir = await owned(scope.folderPath, task.id);
    const freeze = async (file: string) => { const source = await inside(scope.folderPath, file), bytes = await readFile(source), digest = await hashFile(source, signal), target = join(dir, `asset-${digest}${extname(file).toLowerCase()}`); try { await writeFile(target, bytes, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(target)).equals(bytes)) throw error; } if (await hashFile(target, signal) !== digest) throw new Error("材料读取期间发生变化，请重新确认。"); return relative(scope.folderPath, target); };
    snapshot.images = await Promise.all(snapshot.images.map(async image => ({ ...image, file: await freeze(image.file) })));
    if (snapshot.cover) snapshot.cover = await freeze(snapshot.cover);
    for (const [ratio, file] of Object.entries(snapshot.publication.coverFiles ?? {})) if (file) snapshot.publication.coverFiles![ratio as keyof NonNullable<PublicationDraft["coverFiles"]>] = await freeze(file);
    if (publication.type === "article") snapshot.articleFile = relative(scope.folderPath, await snapshotPublicationArticle(scope.folderPath, dir, publication, body, images.map(i => i.file)));
    await atomic(join(dir, "publication-snapshot.json"), snapshot);
    task.packageFile = relative(scope.folderPath, join(dir, "publication-snapshot.json"));
    latest.tasks.push(task); host.reserve(task.id); return { task, fresh: true };
  });
}
export async function executePublicationUpload(folder: string, task: ProductionTask, operation: "create" | "resume" | "inspect", signal: AbortSignal, host: UploadHost): Promise<void> {
  if (!task.packageFile || !task.publicationId) throw new Error("上传缺少固定材料。");
  const snapshot = JSON.parse(await readFile(await inside(folder, task.packageFile), "utf8")) as PublicationSnapshot;
  const { publication } = snapshot, dir = await owned(folder, task.id), settings = await readSettings(host.dataDir);
  for (const image of snapshot.images) if (await hashFile(await inside(folder, image.file), signal) !== image.sha256) throw new Error("本次图片文件已变化，请核对原任务。");
  let receipt: string, remoteId: string | undefined, savedDraft = false;
  if (publication.platform === "official-account") {
    if (settings.wechat.appid !== snapshot.accountId) throw new Error("公众号账号已变化，请切回原账号。");
    const secret = await host.key(wechatCredential(snapshot.accountId)); if (!secret || !snapshot.cover) throw new Error("请先完成公众号账号及封面配置。");
    const article = await publicationArticleForRender(folder, snapshot.articleFile ? await inside(folder, snapshot.articleFile) : await snapshotPublicationArticle(folder, dir, publication, snapshot.body, snapshot.images.map(i => i.file)), publication.title);
    const state = await readState(folder), record = [...(state.records ?? [])].reverse().find(r => r.publicationId === publication.id && r.accountId === snapshot.accountId && r.remoteId);
    const previous = state.drafts.find((d) => d.appid === snapshot.accountId && (record?.remoteId ? d.mediaId === record.remoteId : d.articleFile === publication.bodyFile));
    const draft = await submitWechat({ dataDir: host.dataDir, folder, dir, articleFile: article, cover: snapshot.cover, config: settings.wechat, secret, ...(previous ? { previous } : {}), operation: operation === "inspect" ? "inspect" : "publish", signal });
    await updateState(folder, (s) => { const i = s.drafts.findIndex((d) => d.id === draft.id); if (i < 0) s.drafts.push(draft); else s.drafts[i] = draft; });
    receipt = relative(folder, join(dir, "wechat-receipt.json")); remoteId = draft.mediaId; savedDraft = true;
  } else {
    const account = settings.accounts[publication.platform]; if (!account || account.id !== snapshot.accountId) throw new Error("当前账号与上传任务不一致，请切回原账号。");
    const result = await withBrowser(host.dataDir, signal, async (current) => {
      await requireAccount(publication.platform as PublishPlatform, snapshot.accountId, current);
      if (publication.type === "video") {
        const prepared = operation !== "inspect" ? await makeUploadPackage({ dataDir: host.dataDir, folder, dir, video: snapshot.video!.name, covers: publication.coverFiles ?? {}, fields: { platform: publication.platform as PublishPlatform, title: publication.title, description: snapshot.body, tags: publication.tags, originalRightsConfirmed: true, useCovers: Boolean(Object.keys(publication.coverFiles ?? {}).length), ...(publication.category ? { category: publication.category } : {}) }, signal: current }) : { file: relative(folder, join(dir, "publish-package.json")) };
        const videoTask = { ...task, packageFile: prepared.file };
        try { return await runUpload({ dataDir: host.dataDir, folder, dir, task: videoTask, account, operation, signal: current }); }
        finally { await releaseUploadBrowser(folder, videoTask).catch(() => undefined); }
      }
      let graphicFile = await inside(folder, task.packageFile!);
      if (publication.type === "article") {
        const article = await publicationArticleForRender(folder, snapshot.articleFile ? await inside(folder, snapshot.articleFile) : await snapshotPublicationArticle(folder, dir, publication, snapshot.body, snapshot.images.map(i => i.file)), publication.title);
        const rendered = await formatArticle(host.dataDir, folder, article, settings.wechat.theme, current);
        graphicFile = join(dir, "graphic-input.json"); await atomic(graphicFile, { ...snapshot, html: rendered.html });
      }
      const script = await resource("scripts", "graphic-publisher.mjs"), program = `const {runGraphicPublisher}=await import(${JSON.stringify(new URL(`file:///${script.replace(/\\/g, "/")}`).href)});await runGraphicPublisher(${JSON.stringify({ folder, taskId: task.id, operation, snapshotFile: graphicFile })});`;
      const result = await runProcess(await browserExecutable(), ["nodejs"], { input: program, signal: current, timeout: 300_000 });
      const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).reverse().find((s) => s.startsWith("CREATOR_GRAPH:"));
      if (!line) throw new Error("图文上传未返回可靠结果，请检查原任务页面后继续。");
      const observed = JSON.parse(line.slice("CREATOR_GRAPH:".length)) as { ready: boolean; savedDraft?: boolean; receipt: string; remoteId?: string; error?: string; userControl: boolean };
      await updateState(folder, state => { state.tasks.find(t => t.id === task.id)!.receipt = observed.receipt; });
      if (observed.userControl) throw new BrowserControlError(observed.error ?? "浏览器已交还，请明确继续原任务。");
      await requireAccount(publication.platform as PublishPlatform, snapshot.accountId, current);
      return observed;
    });
    if (!result.ready) {
      await updateState(folder, state => { const stored = state.tasks.find(t => t.id === task.id)!; stored.status = "blocked"; stored.receipt = result.receipt; stored.error = result.error ?? "材料尚未核对完成，请检查原任务。"; stored.updatedAt = Date.now(); });
      host.changed(); return;
    }
    const currentAccount = (await readSettings(host.dataDir)).accounts[publication.platform];
    if (currentAccount?.id !== snapshot.accountId) throw new Error("任务完成时账号配置已变化，结果已保留，请切回原账号核对。");
    receipt = result.receipt; remoteId = "remoteId" in result ? result.remoteId as string | undefined : undefined; savedDraft = "savedDraft" in result && result.savedDraft === true;
  }
  await updateState(folder, (state) => {
    const stored = state.tasks.find((t) => t.id === task.id)!; stored.status = "ready"; stored.step = savedDraft ? "平台草稿已保存" : "已上传，待人工发表"; stored.receipt = receipt; stored.updatedAt = Date.now(); delete stored.error;
    const record: PublicationRecord = { id: task.id, publicationId: publication.id, revision: publication.revision, platform: publication.platform, type: publication.type, accountId: snapshot.accountId, taskId: task.id, state: savedDraft ? "draft" : "uploaded", submittedFile: task.packageFile!, updatedAt: Date.now(), receipt, ...(remoteId ? { remoteId } : {}) };
    const records = state.records ??= [], index = records.findIndex((r) => r.id === task.id); if (index < 0) records.push(record); else records[index] = record;
  }); host.changed();
}
