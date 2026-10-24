// @vitest-environment jsdom
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
const adapter = await import(pathToFileURL(resolve('scripts/publisher-douyin-adapter.mjs')).href);
const form = '<main><h2>发布设置</h2><p>谁可以看</p><p>保存权限</p><p>发布时间</p><input placeholder="填写作品标题，为作品获得更多流量"><div contenteditable="true"></div><button>发布</button><button>暂存离开</button></main>';
function home(html = form, pathname = '/creator-micro/content/post/video') {
  vi.stubGlobal('location', new URL(`https://creator.douyin.com${pathname}`));
  document.body.innerHTML = html;
  Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => document.body.textContent });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 1, y: 1, width: 100, height: 30, top: 1, bottom: 31, left: 1, right: 101, toJSON() {} });
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Douyin current publishing settings', () => {
  it('records an unavailable cross-platform control only on the complete current editor', () => {
    home();
    expect(adapter.readDouyinSyncAvailability()).toEqual({ status: 'not-offered', evidence: 'complete-current-publishing-form' });
  });
  it('keeps the legacy settings path whenever a sync control is offered', () => {
    home(form + '<label><input type="checkbox">不同时发布</label>');
    expect(adapter.readDouyinSyncAvailability()).toEqual({ status: 'offered' });
    document.body.innerHTML = form + '<p>今日头条</p><button role="switch" aria-checked="true"></button>';
    expect(adapter.readDouyinSyncAvailability()).toEqual({ status: 'offered' });
  });
  it('does not infer an off switch from an incomplete, hidden or foreign form', () => {
    home(form.replace('<button>暂存离开</button>', ''));
    expect(adapter.readDouyinSyncAvailability().status).toBe('unknown');
    document.body.innerHTML = form.replace('contenteditable="true"', 'contenteditable="true" style="display:none"');
    expect(adapter.readDouyinSyncAvailability().status).toBe('unknown');
    document.body.innerHTML = form;
    vi.stubGlobal('location', new URL('https://example.com/creator-micro/content/post/video'));
    expect(adapter.readDouyinSyncAvailability().status).toBe('unknown');
  });
  it('preserves legacy gate failures and expresses not-offered separately from disabled', async () => {
    home();
    const snippet = `const douyinTitle = 'test';
      const state = (()=>{return {text:text.slice(0,2800),noSyncChecked:false,syncOn:false,simultaneousChecked:false};})();
      const gates={settings: state.noSyncChecked&&!state.syncOn&&!state.simultaneousChecked ? okGate({disabled:true}) : failedGate({disabled:false})};
      async function turnOffDouyinSync() {return {ok:false,legacy:true};}
      function coverTrigger(card){return card?.querySelector('.title-wA45Xd,.filter-k_CjvJ')||card;}
      async function coverFlow(asset,button,label){
        const exposed=await js(String.raw\`((slot) => null)()\`);
        const action=(()=>{const r=button.getBoundingClientRect();return{label,x:r.left+r.width/2,y:r.top+r.height/2}})();
        await click([action.x,action.y],{label:\`douyin cover \${action.label}\`}).catch(()=>{});
        return exposed;
      }
      return {gates,action:await turnOffDouyinSync(),coverTrigger};`;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction('text', 'okGate', 'failedGate', 'js', adapter.adaptDouyinSource('douyin', snippet));
    const invoke = () => run('', (evidence: unknown) => ({ ok: true, evidence }), (evidence: unknown) => ({ ok: false, evidence }), (code: string) => new Function(`return ${code}`)());
    expect(await invoke()).toMatchObject({ gates: { settings: { ok: true, evidence: { simultaneousPublish: 'not-offered' } } }, action: { ok: true, availability: { status: 'not-offered' } } });
    const card=document.createElement('div');card.innerHTML='<div class="cover-Jg3T4p">选择封面</div><div class="controlContainer-psV7_j">竖封面3:4</div>';
    expect((await invoke()).coverTrigger(card)).toBe(card.firstElementChild);
    document.body.innerHTML += '<label>不同时发布<input type="checkbox"></label>';
    expect(await invoke()).toMatchObject({ gates: { settings: { ok: false } }, action: { ok: false, legacy: true } });
  });
  it('fails closed when the pinned source signature changes', () => {
    expect(() => adapter.adaptDouyinSource('douyin', 'const douyinTitle = "test";')).toThrow('no longer matches');
    expect(adapter.adaptDouyinSource('bilibili', 'unchanged')).toBe('unchanged');
  });
  it('selects and verifies the requested cover step before injecting a file', async () => {
    home('<div role="dialog"><div class="step-dXVbPX step-active-AWDV7U">设置横封面</div><div class="step-dXVbPX">设置竖封面</div></div>');
    const click=vi.fn(async (selector: string)=>{document.querySelector('[class*="step-active"]')!.className='step-dXVbPX';document.querySelector(selector)!.className='step-dXVbPX step-active-AWDV7U';});
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    const run=new AsyncFunction('js','click','wait',`const readDouyinCoverStep=${adapter.readDouyinCoverStep.toString()};return await (${adapter.ensureDouyinCoverStep.toString()})('portrait');`);
    const execute=(code: string)=>new Function(`return ${code}`)();
    expect(await run(execute,click,vi.fn())).toEqual({ok:true,ready:true});
    expect(click).toHaveBeenCalledOnce();
    expect(await run(execute,click,vi.fn())).toEqual({ok:true,ready:true});
    expect(click).toHaveBeenCalledOnce();
    document.body.innerHTML='<div role="dialog">封面入口未加载</div>';
    expect(await run(execute,click,vi.fn())).toMatchObject({ok:false});
    expect(click).toHaveBeenCalledOnce();
  });
});
