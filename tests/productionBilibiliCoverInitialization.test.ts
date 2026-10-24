// @vitest-environment jsdom
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
const adapter=await import(pathToFileURL(resolve('scripts/publisher-bilibili-adapter.mjs')).href);
const asset={slot:'personal-space',ratio:'16:9',editor:'#editor_16_9',path:'C:/验收/横版封面.png'};
function fixture(){
 document.body.innerHTML='<div class="bcc-dialog">封面制作<div class="cover-editor-panel-canvas-empty ratio_4_3"><input type="file"></div><div class="cover-editor-panel-canvas-empty ratio_16_9"><input type="file"></div></div>';
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({width:600,height:400} as DOMRect);
}
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
describe('Bilibili empty cover slot initialization',()=>{
 it('targets the requested empty ratio and preserves the other slot',()=>{
  fixture();expect(adapter.locateEmptyBilibiliCover(asset)).toMatchObject({ok:true,needed:true,selector:'#creator-bili-empty-cover'});
  expect(document.querySelector('#creator-bili-empty-cover')?.parentElement?.className).toContain('ratio_16_9');
  expect(document.querySelector('.ratio_4_3 input')?.id).toBe('');
  document.querySelector('.ratio_16_9')!.insertAdjacentHTML('beforeend','<canvas id="editor_16_9"></canvas>');
  expect(adapter.locateEmptyBilibiliCover(asset)).toEqual({ok:true,needed:false});
 });
 it('waits for the real editor to be created without inventing an active state',async()=>{
  fixture();const uploaded=vi.fn(async(selector:string,file:string)=>{expect(file).toBe(asset.path);document.querySelector(selector)!.parentElement!.insertAdjacentHTML('beforeend','<canvas id="editor_16_9"></canvas>');});
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('js','uploadFile','wait','asset',`const locateEmptyBilibiliCover=${adapter.locateEmptyBilibiliCover.toString()};return await (${adapter.prepareEmptyBilibiliCover.toString()})(asset);`);
  expect(await run((code:string)=>new Function(`return ${code}`)(),uploaded,vi.fn(),asset)).toEqual({ok:true,initialized:true});
  expect(uploaded).toHaveBeenCalledOnce();expect(document.querySelector('.active')).toBeNull();
 });
 it('fails closed on unknown, ambiguous inputs or pinned-source drift',()=>{
  fixture();expect(adapter.locateEmptyBilibiliCover({...asset,editor:'#other'}).ok).toBe(false);
  document.querySelector('.ratio_16_9')!.insertAdjacentHTML('beforeend','<input type="file">');
  expect(adapter.locateEmptyBilibiliCover(asset).ok).toBe(false);
  expect(()=>adapter.adaptBilibiliSource('bilibili','const bilibiliTitle = "test";')).toThrow('no longer matches');
  expect(adapter.adaptBilibiliSource('douyin','unchanged')).toBe('unchanged');
 });
});
