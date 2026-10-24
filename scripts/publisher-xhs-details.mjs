// The pinned publisher prepares topics but does not handle Xiaohongshu prose.
// Keep this additive check outside its source, and preserve native topic entities.
export const XHS_DETAILS_MARKER = 'CREATOR_XHS_DETAILS:';
export function inspectXhsDetails(expected) {
  const compact = value => String(value ?? '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const title = [...document.querySelectorAll('input')].find(el => el.placeholder.includes('填写标题'))?.value ?? '';
  const editors = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')].filter(el => {
    const bounds = el.getBoundingClientRect(), style = getComputedStyle(el);
    return bounds.width > 4 && bounds.height > 4 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (editors.length !== 1) return { ready: false, error: '无法唯一识别小红书正文编辑区，请核对原草稿。' };
  const editor = editors[0], clone = editor.cloneNode(true);
  clone.querySelectorAll('a').forEach(el => el.remove());
  const actual = compact(clone.textContent);
  const sameDraft = (document.body.innerText || document.body.textContent || '').includes(expected.videoName) && title === expected.title;
  return {
    sameDraft, ready: sameDraft && actual === compact(expected.description), actual,
    expected: compact(expected.description), canInsert: sameDraft && actual === '',
    topics: [...editor.querySelectorAll('a')].map(el => el.getAttribute('data-topic') || el.textContent),
    ...(sameDraft ? {} : { error: '当前编辑页与原上传任务不一致，未修改正文。' }),
  };
}
export function xhsDetailsScript(expected, { spaceId, mutate = false, resume = false }) {
  if (!Number.isSafeInteger(spaceId) || spaceId < 1) throw new Error('Invalid upload space');
  return `
const id=${spaceId}, input=${JSON.stringify(expected)};
const entry=(await listTaskSpaces()).find(s=>s.id===id);
if(!entry || !entry.name.includes(${JSON.stringify(expected.taskId)})) throw new Error('Upload task space no longer matches');
const task=entry.ownership==='agent' ? await taskSpace(id) : ${resume} && entry.ownership==='agentDelegatedToUser' ? await takeOverTaskSpace(id) : undefined;
if(!task) throw new Error('USER_CONTROL: upload task is not assigned to the agent');
const pages=await task.pages(); if(pages.length!==1) throw new Error('Upload task page is ambiguous');
const page=pages[0], inspect=${inspectXhsDetails.toString()};
let result=await page.evaluate(inspect,input);
if(${mutate} && !result.ready && result.canInsert){
  const prepared=await page.evaluate(()=>{
    const editors=[...document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'});
    if(editors.length!==1)return false;
    const editor=editors[0],clone=editor.cloneNode(true);clone.querySelectorAll('a').forEach(el=>el.remove());
    if(String(clone.textContent||'').replace(/[\\s\\u200b\\ufeff]/g,''))return false;
    editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);range.collapse(true);selection.removeAllRanges();selection.addRange(range);return document.activeElement===editor;
  });
  if(prepared){await page.keyboard.insertText(input.description+'\\n');result=await page.evaluate(inspect,input);}
}
if(!result.ready && !result.error)result.error='正文与上传材料不一致，请核对原草稿；已有文字保持原样。';
console.log(${JSON.stringify(XHS_DETAILS_MARKER)}+JSON.stringify(result));
`;
}
