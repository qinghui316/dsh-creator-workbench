export function locateEmptyBilibiliCover(asset) {
  if (!['#editor_4_3','#editor_16_9'].includes(asset.editor)) return {ok:false,reason:'unknown Bilibili cover slot'};
  if (document.querySelector(asset.editor)) return {ok:true,needed:false};
  const dialogs=[...document.querySelectorAll('.bcc-dialog')].filter(el=>el.getBoundingClientRect().width>20&&el.textContent.includes('封面制作'));
  if(dialogs.length!==1)return {ok:false,reason:'Bilibili cover dialog missing or ambiguous'};
  const ratio=asset.editor==='#editor_4_3'?'4_3':'16_9';
  const inputs=[...dialogs[0].querySelectorAll(`.cover-editor-panel-canvas-empty.ratio_${ratio} input[type=file]`)];
  if(inputs.length!==1)return {ok:false,reason:'Bilibili empty ratio input missing or ambiguous'};
  inputs[0].id='creator-bili-empty-cover';
  return {ok:true,needed:true,selector:'#creator-bili-empty-cover'};
}
export async function prepareEmptyBilibiliCover(asset) {
  const located=await js(`(${locateEmptyBilibiliCover.toString()})(${JSON.stringify(asset)})`);
  if(!located.ok||!located.needed)return located;
  await uploadFile(located.selector,asset.path);
  for(let attempt=0;attempt<24;attempt++){
    const ready=await js(`Boolean(document.querySelector(${JSON.stringify(asset.editor)}))`);
    if(ready)return {ok:true,initialized:true};
    await wait(.25);
  }
  return {ok:false,reason:'Bilibili ratio editor did not initialize after file selection'};
}
export function adaptBilibiliSource(platform,script) {
  if(platform!=='bilibili'||!script.includes('const bilibiliTitle ='))return script;
  const entry="await click(asset.editor,{label:'select bilibili cover slot'});";
  if(script.split(entry).length!==2)throw new Error('Pinned Bilibili cover adapter no longer matches');
  return `const locateEmptyBilibiliCover=${locateEmptyBilibiliCover.toString()};\n${prepareEmptyBilibiliCover.toString()}\n${script.replace(entry,"const preparedEmpty=await prepareEmptyBilibiliCover(asset);if(!preparedEmpty.ok)return preparedEmpty;"+entry)}`;
}
