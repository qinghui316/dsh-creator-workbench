import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/production/articlePreview.ts", () => ({ formatArticle: vi.fn(async () => ({ html: "<h1>成品</h1>", path: "preview.html" })) }));
import { articleSource, saveArticleRevision, previewArticleEdit } from "../src/production/articleEditing.ts";
import { formatArticle } from "../src/production/articlePreview.ts";
import { readState, updateState, owned, hashText } from "../src/production/storage.ts";
async function fixture() {
 const folder = await mkdtemp(join(tmpdir(), "creator-edit-"));
 await writeFile(join(folder, "article.md"), "# 原文\n\n正文\n\n![配图](image.png)"); await writeFile(join(folder, "image.png"), "image bytes");
 await updateState(folder, s => { s.articles.push({id:"original",file:"article.md",createdAt:1,frameFiles:[]}); s.tasks.push({id:"wechat",kind:"wechat",status:"running",contentId:"one",folderPath:folder,createdAt:1,updatedAt:1,articleFile:"article.md"}); });
 const base = await articleSource(folder,"original");
 return {folder,base,request:{id:"one",folderPath:folder,articleId:"original",expectedSourceHash:base.sourceHash,source:base.source.replace("正文","修改正文"),saveId:"save-test-123"}};
}
describe("immutable article source revisions",()=>{
 it("coalesces concurrent/retried saves, freezes resources, and preserves originals and submission tasks",async()=>{
  const f=await fixture(),before=await readState(f.folder);
  const args=["data",f.folder,f.request,"theme",new AbortController().signal,async()=>undefined] as const;
  const [a,b]=await Promise.all([saveArticleRevision(...args),saveArticleRevision(...args)]);
  expect(a.article.id).toBe(b.article.id);expect((await readState(f.folder)).articles).toHaveLength(2);
  expect((await readState(f.folder)).tasks).toEqual(before.tasks);expect(await readFile(join(f.folder,"article.md"),"utf8")).toBe(f.base.source);
  expect(a.source).toContain("修改正文"); const ref=a.source.match(/!\[配图\]\(([^)]+)\)/)![1]!;
  expect(await readFile(join(f.folder,dirname(a.article.file),ref),"utf8")).toBe("image bytes");
  await writeFile(join(f.folder,"image.png"),"external change");expect(await readFile(join(f.folder,dirname(a.article.file),ref),"utf8")).toBe("image bytes");
 });
 it("rejects modified source or a reused save ID with different input",async()=>{
  const f=await fixture();await saveArticleRevision("data",f.folder,f.request,"theme",new AbortController().signal,async()=>undefined);
  await expect(saveArticleRevision("data",f.folder,{...f.request,source:"# 别的正文"},"theme",new AbortController().signal,async()=>undefined)).rejects.toThrow("保存请求");
  await writeFile(join(f.folder,"article.md"),"# 外部改写\n正文");
  await expect(saveArticleRevision("data",f.folder,{...f.request,saveId:"second-save-123"},"theme",new AbortController().signal,async()=>undefined)).rejects.toThrow("来源文章已被修改");
 });
 it("previews unsaved source without changing any task/version, and reports render failure after a successful save",async()=>{
  const f=await fixture(),before=await readState(f.folder);await previewArticleEdit("data",f.folder,f.request,"theme",new AbortController().signal);
  expect(await readState(f.folder)).toEqual(before);
  vi.mocked(formatArticle).mockRejectedValueOnce(new Error("排版失败"));
  const saved=await saveArticleRevision("data",f.folder,f.request,"theme",new AbortController().signal,async()=>undefined);
  expect(saved.previewError).toBe("排版失败");expect((await readState(f.folder)).articles.some(a=>a.id===saved.article.id)).toBe(true);
 });
 it("retains HTML format and rejects project boundary escapes",async()=>{
  const f=await fixture();await writeFile(join(f.folder,"article.html"),"<h1>标题</h1><p>正文</p>");await updateState(f.folder,s=>{s.articles.push({id:"html",file:"article.html",format:"html",createdAt:1,frameFiles:[]});});
  const base=await articleSource(f.folder,"html"),saved=await saveArticleRevision("data",f.folder,{...f.request,articleId:"html",expectedSourceHash:base.sourceHash,source:"<h1>改后标题</h1><p>新正文</p>"},"theme",new AbortController().signal,async()=>undefined);
  expect(saved.article.format).toBe("html");expect(saved.article.file).toMatch(/html$/);
  await expect(articleSource(f.folder,"../outside")).rejects.toThrow("版本不存在");
 });
 it("keeps Markdown format with leading HTML and freezes entity-encoded HTML image paths",async()=>{
  const f=await fixture();
  const md=await saveArticleRevision("data",f.folder,{...f.request,source:'<section>提示</section>\n\n# 标题\n\n![配图](image.png)'},"theme",new AbortController().signal,async()=>undefined);
  expect(md.article.format).toBe("markdown");expect(md.article.file).toMatch(/\.md$/);expect(md.source).toContain("article-image-");
  await writeFile(join(f.folder,"a&b.png"),"image amp");await writeFile(join(f.folder,"entity.html"),'<h1>标题</h1><img src="a&amp;b.png">');
  await updateState(f.folder,s=>{s.articles.push({id:"entity",file:"entity.html",format:"html",createdAt:1,frameFiles:[]});});
  const base=await articleSource(f.folder,"entity");
  const html=await saveArticleRevision("data",f.folder,{...f.request,articleId:"entity",expectedSourceHash:base.sourceHash,source:base.source,saveId:"entity-save-123"},"theme",new AbortController().signal,async()=>undefined);
  expect(html.source).toContain("article-image-");expect(html.article.format).toBe("html");
 });
 it("continues a manifest-matching unregistered partial save without overwriting originals",async()=>{
  const f=await fixture(),dir=await owned(f.folder,"articles",`edit-${f.request.saveId}`);
  const inputHash=hashText(JSON.stringify([f.request.articleId,f.request.expectedSourceHash,f.request.source]));
  await writeFile(join(dir,"save-input.json"),JSON.stringify({inputHash}));await writeFile(join(dir,"publication-body.md"),"partial");
  const saved=await saveArticleRevision("data",f.folder,f.request,"theme",new AbortController().signal,async()=>undefined);
  expect(saved.source).toContain("修改正文");expect((await readdir(dir)).some(name=>name.startsWith("publication-body.md.incomplete-"))).toBe(true);
  expect(await readFile(join(f.folder,"article.md"),"utf8")).toBe(f.base.source);
 });
});
