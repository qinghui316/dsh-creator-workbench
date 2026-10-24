export const BILI_DETAILS_MARKER = 'CREATOR_BILI_DETAILS:';
export function inspectBilibiliCategory(expected) {
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = compact(document.body.innerText || document.body.textContent);
  const title = document.querySelector('input[placeholder*="稿件标题"]')?.value;
  const stem = expected.videoName.replace(/\.[^.]+$/, '');
  const sameDraft = location.hostname === 'member.bilibili.com' && location.pathname.includes('/platform/upload/')
    && title === expected.title && text.includes(stem) && text.includes('上传完成');
  if (!sameDraft) return { ready: false, sameDraft: false, error: '当前 B 站页面与原上传任务不一致，分区保持原样。' };
  const fields = [...document.querySelectorAll('.video-human-type')];
  if (fields.length !== 1) return { ready: false, sameDraft: true, error: '无法唯一识别 B 站分区，请核对原草稿。' };
  const field = fields[0], actual = compact(field.querySelector('.select-controller p')?.textContent);
  const requested = compact(expected.category), valid = Boolean(actual) && !/请选择|选择分区/.test(actual);
  field.querySelector('.select-controller')?.setAttribute('id', 'creator-bili-category');
  const options = [...field.querySelectorAll('.human-type-list .drop-list-v2-item')].filter(el => compact(el.getAttribute('title')) === requested);
  if (options.length === 1) options[0].id = 'creator-bili-category-option';
  return { ready: valid && (!requested || actual === requested), sameDraft: true, actual, requested, mode: requested ? 'explicit' : 'platform-recommended', optionFound: options.length === 1 };
}
export function bilibiliDetailsScript(expected, {spaceId,mutate=false,resume=false,previouslyVerified=false}) {
  if (!Number.isSafeInteger(spaceId) || spaceId < 1) throw new Error('Invalid upload space');
  return `const id=${spaceId},input=${JSON.stringify(expected)};
const entry=(await listTaskSpaces()).find(s=>s.id===id);
if(!entry||!entry.name.includes(${JSON.stringify(expected.taskId)}))throw new Error('Upload task space no longer matches');
const task=entry.ownership==='agent'?await taskSpace(id):${resume}&&entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(id):undefined;
if(!task)throw new Error('USER_CONTROL: upload task is not assigned to the agent');
const pages=await task.pages();if(pages.length!==1)throw new Error('Upload task page is ambiguous');
const page=pages[0],inspect=${inspectBilibiliCategory.toString()};
let result=await page.evaluate(inspect,input);
if(${mutate}&&!${previouslyVerified}&&result.sameDraft&&!result.ready&&result.requested){
 await page.click('#creator-bili-category',{label:'open requested Bilibili category'});
 result=await page.evaluate(inspect,input);
 if(result.optionFound){
   await page.click('#creator-bili-category-option',{label:'select exact Bilibili category'});
   await page.waitForFunction(input=>(${inspectBilibiliCategory.toString()})(input).ready,input,{timeout:5000}).catch(error=>{if(!/timeout/i.test(String(error?.message)))throw error;});
 }
 result=await page.evaluate(inspect,input);
}
if(!result.ready&&!result.error)result.error=${previouslyVerified}?'B 站分区已被修改，请核对原草稿；当前选择保持原样。':'B 站分区与上传材料不一致，请核对平台实际选项。';
console.log(${JSON.stringify(BILI_DETAILS_MARKER)}+JSON.stringify(result));`;
}
