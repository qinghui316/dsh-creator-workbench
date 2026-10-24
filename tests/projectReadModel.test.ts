import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { queryProject } from "../src/production/projectQuery.ts";
import { updateState } from "../src/production/storage.ts";
import { publicationLabel, publicationMetric, productionView, coverView } from "../src/projectView.ts";
import { emptyProduction } from "../src/production/types.ts";
import type { ContentSummary } from "../src/types.ts";
it("reads bounded script metadata without hydrating missing platform bodies or reconciling interrupted tasks",async()=>{
 const folder=await mkdtemp(join(tmpdir(),"creator-query-"));await writeFile(join(folder,"script.md"),"正文".repeat(10000));
 await updateState(folder,s=>{s.tasks.push({id:"orphan",contentId:"one",folderPath:folder,kind:"upload",status:"running",createdAt:1,updatedAt:1});s.publications=[{id:"p",revision:1,platform:"xiaohongshu",type:"images",title:"材料",bodyFile:"missing.md",imageIds:[],tags:[],createdAt:1,updatedAt:1}];});
 const index=join(folder,".dsh-creator-workbench/production/index.json"),before=await readFile(index,"utf8");
 const view=await queryProject({id:"one",folderPath:folder} as ContentSummary);
 expect(view.script.excerpt.length).toBeLessThanOrEqual(240);expect(view.production.publications?.[0]?.body).toBeUndefined();expect(view.production.publications?.[0]?.bodyError).toBeUndefined();expect(view.detail.article).toBe("");expect(await readFile(index,"utf8")).toBe(before);
});
it("returns bounded readable article and subtitle excerpts while preserving source bytes and task records",async()=>{
 const folder=await mkdtemp(join(tmpdir(),"creator-excerpt-"));await writeFile(join(folder,"article.html"),'<style>private-style</style><h1>文章标题</h1><p>真实文章正文'+"内容".repeat(9000)+'</p>');await writeFile(join(folder,"captions.srt"),'1\n00:00:01,000 --> 00:00:03,000\n真实字幕片段\n');
 await updateState(folder,s=>{s.articles.push({id:"a",file:"article.html",format:"html",createdAt:1,frameFiles:[]});});
 const item={id:"one",folderPath:folder,subtitles:{srt:"captions.srt"}} as ContentSummary,index=join(folder,".dsh-creator-workbench/production/index.json"),before=await readFile(index,"utf8");
 const view=await queryProject(item);expect(view.excerpts?.article?.id).toBe("a");expect(view.excerpts?.article?.text).toContain("真实文章正文");expect(view.excerpts?.article?.text.length).toBeLessThanOrEqual(240);expect(view.excerpts?.article?.text).not.toContain("private-style");expect(view.excerpts?.subtitle?.text).toBe("真实字幕片段");expect(await readFile(index,"utf8")).toBe(before);
 await writeFile(join(folder,"article.html"),'<p>外部更新后的正文</p>');expect((await queryProject(item)).excerpts?.article?.text).toBe("外部更新后的正文");
 await writeFile(join(folder,"article.html"),'<p>5&lt;10 &amp; &quot;引号&quot;</p>');expect((await queryProject(item)).excerpts?.article?.text).toBe('5<10 & "引号"');
 await updateState(folder,s=>{s.transcripts.push({id:"old",source:"imported",srtFile:"captions.srt",textFile:"captions.srt",createdAt:1,cues:1,video:{name:"old.mp4",size:2,modifiedAt:1,sha256:"old"}});});
 expect((await queryProject({...item,selectedVideo:"new.mp4",videos:[{name:"new.mp4",path:"new.mp4",size:3,modifiedAt:2}]})).excerpts?.subtitle).toBeUndefined();
});
it("does not label a different platform, media type or current account as published",()=>{
 const state=emptyProduction();state.publications=[{id:"p",revision:2,platform:"xiaohongshu",type:"images",title:"材料",bodyFile:"body.md",imageIds:[],tags:[],createdAt:1,updatedAt:2}];
 state.records=[{id:"r",publicationId:"p",revision:1,platform:"bilibili",type:"video",accountId:"old",state:"published",updatedAt:1}];
 expect(publicationLabel(state,"p",{xiaohongshu:"current"})).toBe("历史作品");state.records[0]={...state.records[0]!,platform:"xiaohongshu",type:"images",accountId:"current"};expect(publicationLabel(state,"p",{xiaohongshu:"current"})).toBe("已发表 · 本地有修改");expect(publicationLabel(state,"p",{xiaohongshu:"other"})).toBe("历史作品");
 state.records[0]!.remoteId="actual";state.metrics=[{platform:"xiaohongshu",accountId:"current",publicationId:"p",remoteId:"actual",state:"ok",checkedAt:1,views:0}];
 expect(publicationMetric(state,state.publications[0]!,"current")?.views).toBe(0);expect(publicationMetric(state,state.publications[0]!,"current")?.likes).toBeUndefined();expect(publicationMetric(state,state.publications[0]!,"other")).toBeUndefined();
});
it("keeps long creation evidence and prompts out of default metadata without changing persistent records",()=>{
 const state=emptyProduction(),long="LONG_EVIDENCE".repeat(3000);
 state.tasks=[{id:"image",kind:"images",status:"running",contentId:"one",folderPath:"C:/one",createdAt:1,updatedAt:1,source:{kind:"topic",text:long},imageItems:[{id:"slot",prompt:long,ratio:"3x4",purpose:"card",references:[],status:"running"}]}];
 state.articles=[{id:"a",file:"article.md",frameFiles:[],createdAt:1,source:{kind:"topic",text:long}}];
 const view=productionView(state);expect(JSON.stringify(view)).not.toContain("LONG_EVIDENCE");expect(state.tasks[0]!.imageItems![0]!.prompt).toBe(long);
 const covers={versions:[],selected:{},runs:[{id:"r",contentId:"one",folderPath:"C:/one",createdAt:1,updatedAt:1,video:{name:"one.mp4",size:1,modifiedAt:1},ratios:["3x4" as const],status:"running" as const,frames:[],analysis:long,slots:{"3x4":{status:"running" as const,versionId:"v",prompt:long}}}]};
 expect(JSON.stringify(coverView(covers))).not.toContain("LONG_EVIDENCE");expect(covers.runs[0]!.analysis).toBe(long);
});
