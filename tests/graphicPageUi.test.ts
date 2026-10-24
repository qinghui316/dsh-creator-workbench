// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {inspectGraphicPage}=await import(pathToFileURL(resolve('scripts/graphic-publisher.mjs')).href);
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
describe('Bili saved article readback',()=>{
 it('ignores only the native empty image-caption placeholder and retains actual user captions',()=>{
  const frame=document.createElement('iframe');document.body.append(frame);frame.setAttribute('src','/york/read-editor');
  const root=frame.contentDocument!;root.open();root.write('<body><textarea placeholder="标题">Title</textarea><div class="ProseMirror" contenteditable="true"><p>Body</p><div class="eva3-image-caption is-placeholder" contenteditable="false" data-empty="true">点此添加图片注释，最多100字（可选）</div><div class="eva3-image-caption" contenteditable="false" data-empty="false">Actual caption</div></div></body>');root.close();
  vi.spyOn(frame.contentWindow!.HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:50,left:0,right:100,top:0,bottom:50,x:0,y:0,toJSON:()=>({})});
  root.querySelectorAll<HTMLElement>('textarea,[contenteditable="true"]').forEach(e=>{e.style.opacity='1';});
  const actual=inspectGraphicPage({title:'Title'});expect(actual.title).toBe('Title');expect(actual.body).toContain('Body');expect(actual.body).toContain('Actual caption');expect(actual.body).not.toContain('点此添加图片注释');
 });
});
