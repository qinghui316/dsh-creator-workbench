// @vitest-environment jsdom
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
const adapter=await import(pathToFileURL(resolve('scripts/publisher-bilibili-details.mjs')).href);
const expected={taskId:'owned-task',videoName:'视频.mp4',title:'验收视频',category:'知识'};
function fixture() {
 vi.stubGlobal('location',new URL('https://member.bilibili.com/platform/upload/video/frame'));
 document.body.innerHTML='<div>视频 上传完成</div><input placeholder="请输入稿件标题"><section class="video-human-type"><h3>分区</h3><div class="select-controller"><p>科技数码</p></div><div class="human-type-list"><div class="drop-list-v2-item" title="知识">知识</div></div></section>';
 document.querySelector('input')!.value=expected.title;
 const page={evaluate:async(fn: (arg: unknown)=>unknown,arg:unknown)=>fn(arg),click:vi.fn(async(selector:string)=>{if(selector==='#creator-bili-category-option')document.querySelector('.select-controller p')!.textContent='知识';}),waitForFunction:vi.fn(async(fn: (arg:unknown)=>unknown,arg:unknown)=>{if(!fn(arg))throw new Error('timeout');})};
 const log=vi.fn(),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=async(options={})=>{await new AsyncFunction('listTaskSpaces','taskSpace','takeOverTaskSpace','console',adapter.bilibiliDetailsScript(expected,{spaceId:70,...options}))(async()=>[{id:70,name:'publisher owned-task',ownership:'agent'}],async()=>({pages:async()=>[page]}),vi.fn(),{log});return JSON.parse(log.mock.calls.at(-1)![0].slice(adapter.BILI_DETAILS_MARKER.length));};
 return {page,run};
}
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();});
describe('Bilibili category completion',()=>{
 it('selects only the exact requested category and independently reads it back',async()=>{
  const {page,run}=fixture();expect((await run()).ready).toBe(false);
  expect(await run({mutate:true})).toMatchObject({ready:true,actual:'知识',mode:'explicit'});
  expect(page.click).toHaveBeenCalledTimes(2);
  expect((await run()).ready).toBe(true);expect(page.click).toHaveBeenCalledTimes(2);
 });
 it('preserves a manual change after a category was verified',async()=>{
  const {page,run}=fixture();expect((await run({mutate:true,previouslyVerified:true})).ready).toBe(false);
  expect(page.click).not.toHaveBeenCalled();
 });
 it('accepts a real platform recommendation but rejects an empty selection',()=>{
  fixture();expect(adapter.inspectBilibiliCategory({...expected,category:''})).toMatchObject({ready:true,mode:'platform-recommended',actual:'科技数码'});
  document.querySelector('.select-controller p')!.textContent='请选择分区';
  expect(adapter.inspectBilibiliCategory({...expected,category:''}).ready).toBe(false);
 });
 it('does not edit a foreign draft, host or ambiguous category option',async()=>{
  const {page,run}=fixture();document.querySelector('input')!.value='用户其他内容';
  expect((await run({mutate:true})).sameDraft).toBe(false);expect(page.click).not.toHaveBeenCalled();
  document.querySelector('input')!.value=expected.title;vi.stubGlobal('location',new URL('https://example.com/platform/upload/video/frame'));
  expect((await run({mutate:true})).sameDraft).toBe(false);expect(page.click).not.toHaveBeenCalled();
  vi.stubGlobal('location',new URL('https://member.bilibili.com/platform/upload/video/frame'));
  document.querySelector('.human-type-list')!.insertAdjacentHTML('beforeend','<div class="drop-list-v2-item" title="知识">知识</div>');
  expect((await run({mutate:true})).ready).toBe(false);expect(page.click).toHaveBeenCalledTimes(1);
 });
});
