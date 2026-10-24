// Private, pinned-source adaptation; never treat a missing selector as an off switch.
export function readDouyinSyncAvailability() {
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = compact(document.body?.innerText);
  const offered = /同时发布|同步发布|今日头条|西瓜视频/.test(text);
  if (offered) return { status: 'offered' };
  const visible = el => {
    if (!el) return false;
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const labels = ['发布设置', '谁可以看', '保存权限', '发布时间'];
  const buttons = [...document.querySelectorAll('button')].filter(visible).map(el => compact(el.textContent));
  const completeForm = location.hostname === 'creator.douyin.com'
    && location.pathname === '/creator-micro/content/post/video'
    && labels.every(label => text.includes(label))
    && visible(document.querySelector('input[placeholder*="作品标题"]'))
    && [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')].some(visible)
    && buttons.includes('发布') && buttons.includes('暂存离开');
  return completeForm ? { status: 'not-offered', evidence: 'complete-current-publishing-form' } : { status: 'unknown' };
}

export function readDouyinCoverStep(slot) {
  const expected = slot === 'portrait' ? '设置竖封面' : '设置横封面';
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(el => !/animate-hide/.test(el.className) && el.textContent.includes('封面'));
  if (dialogs.length !== 1) return { ok: false, reason: 'douyin cover dialog missing or ambiguous' };
  const steps = [...dialogs[0].querySelectorAll('[class*="step-"]')];
  const matches = steps.filter(el => el.textContent.replace(/\s+/g, '') === expected);
  if (matches.length !== 1) return { ok: false, reason: 'douyin cover step missing or ambiguous' };
  if (/step-active/.test(matches[0].className)) return { ok: true, ready: true };
  matches[0].id = 'creator-douyin-cover-step';
  return { ok: true, ready: false, selector: '#creator-douyin-cover-step' };
}

export async function ensureDouyinCoverStep(slot) {
  const inspect = `(${readDouyinCoverStep.toString()})(${JSON.stringify(slot)})`;
  let current = await js(inspect);
  if (!current.ok || current.ready) return current;
  await click(current.selector, { label: 'select requested cover ratio' });
  for (let attempt = 0; attempt < 24; attempt++) {
    current = await js(inspect);
    if (!current.ok || current.ready) return current;
    await wait(.25);
  }
  return { ok: false, reason: 'douyin requested cover step did not activate' };
}

export function adaptDouyinSource(platform, script) {
  if (platform !== 'douyin' || !script.includes('const douyinTitle =')) return script;
  const replaceOnce = (source, before, after) => {
    if (source.split(before).length !== 2) throw new Error('Pinned Douyin settings adapter no longer matches');
    return source.replace(before, after);
  };
  const read = `(${readDouyinSyncAvailability.toString()})()`;
  let adapted = replaceOnce(script, 'return {text:text.slice(0,2800),', `return {syncAvailability:${read},text:text.slice(0,2800),`);
  adapted = replaceOnce(adapted, 'settings: state.noSyncChecked&&!state.syncOn&&!state.simultaneousChecked ?',
    "settings: state.syncAvailability.status==='not-offered' ? okGate({simultaneousPublish:'not-offered',toutiaoSync:'not-offered',availability:state.syncAvailability}) : state.noSyncChecked&&!state.syncOn&&!state.simultaneousChecked ?");
  adapted = replaceOnce(adapted, 'async function turnOffDouyinSync() {',
    `async function turnOffDouyinSync() {\n const availability=await js(${JSON.stringify(read)});if(availability.status==='not-offered')return {ok:true,availability};`);
  // The current clickable image is inside the card; clicking the card center hits its label.
  adapted = replaceOnce(adapted, "card?.querySelector('.title-wA45Xd,.filter-k_CjvJ')||card",
    "card?.querySelector('.cover-Jg3T4p')||card?.querySelector('.title-wA45Xd,.filter-k_CjvJ')||card");
  adapted = replaceOnce(adapted, 'const exposed=await js(String.raw`((slot) =>',
    'const chosenStep=await ensureDouyinCoverStep(asset.slot);if(!chosenStep.ok)return chosenStep;const exposed=await js(String.raw`((slot) =>');
  adapted = replaceOnce(adapted, 'return{label,x:r.left+r.width/2,y:r.top+r.height/2}',
    "button.id='creator-douyin-cover-action';return{label,selector:'#creator-douyin-cover-action'}");
  adapted = replaceOnce(adapted, 'await click([action.x,action.y],{label:`douyin cover ${action.label}`}).catch(()=>{});',
    'await click(action.selector,{label:`douyin cover ${action.label}`});');
  // Semantic clicks await the requested action; do not silently accept a no-op coordinate click.
  return `const readDouyinCoverStep=${readDouyinCoverStep.toString()};\n${ensureDouyinCoverStep.toString()}\n${adapted}`;
}
