// Windows/Ego image-post adapter. Final publication is deliberately outside this module.
import { readFile, writeFile, realpath, rename, lstat } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const GRAPHIC_PLATFORMS = {
  xiaohongshu: { url: 'https://creator.xiaohongshu.com/publish/publish', tab: '上传图文', title: '填写标题', label: '小红书', maxImages:18, maxBytes:32*1024*1024 },
  douyin: { url: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3', tab: '发布图文', title: '作品标题', label: '抖音', maxImages:35, maxBytes:50*1024*1024 },
  bilibili: { url: 'https://member.bilibili.com/platform/upload/text', tab: '', title: '标题', label: 'B站' },
};
const compact = value => String(value ?? '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
export function graphicBodyWithoutTags(body,tags) {
  if(!tags.length)return body.trimEnd();
  const choices=tags.map(tag=>tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  return body.replace(new RegExp(`(?:^|\\s)(?:#(?:${choices})\\s*)+$`,'u'),'').trimEnd();
}
export const publishControlInSnapshot = text => /button "(?:发布|发表|投稿)"|button[^\n]*\n\s+text "(?:发布|发表|投稿)"/.test(text);

/** Serialized into the observed page; no hidden API, account storage or framework state. */
export function inspectGraphicPage(expected) {
  const frame=[...document.querySelectorAll('iframe')].find(e=>e.src.includes('/york/read-editor')); const root=frame?.contentDocument??document;
  const visible = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>4 && r.height>4 && r.right>0 && r.left<innerWidth && s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)>0.01 && !e.closest('[aria-hidden="true"]'); };
  const text = value => String(value ?? '').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const titles = [...root.querySelectorAll('input,textarea')].filter(e => visible(e) && /标题/.test(e.placeholder ?? ''));
  const editors = [...root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea')].filter(e => visible(e) && !titles.includes(e));
  const editor = editors.length === 1 ? editors[0] : editors.find(e => /正文|简介|描述|内容/.test(e.getAttribute('data-placeholder') || e.getAttribute('placeholder') || ''));
  const imageSelector = frame ? '.ProseMirror img' : location.hostname.includes('xiaohongshu') ? '.img-container img.img.preview' : '[draggable="true"][class*="img-"]>img';
  const images = [...root.querySelectorAll(imageSelector)].filter(e => { const r=e.getBoundingClientRect(); return r.width>=45 && r.height>=45 && e.naturalWidth>0 && getComputedStyle(e).display!=='none' && !e.closest('nav,header,[class*="avatar"],[class*="logo"]'); });
  const errors = [...root.querySelectorAll('[role="alert"],[class*="upload-error"],[class*="error-tip"]')].filter(visible).map(e=>e.innerText).filter(s=>/失败|超出|不支持|错误|异常/.test(s));
  let body=editor?.value??'';
  if(editor?.value===undefined&&editor){const copy=editor.cloneNode(true);copy.querySelectorAll('.content-hide,[data-zero-space]').forEach(e=>e.remove());copy.querySelectorAll('br').forEach(e=>e.replaceWith('\n'));copy.querySelectorAll('p,div,h1,h2,h3,h4,li,blockquote').forEach(e=>e.append('\n'));body=copy.textContent;}
  return { title: titles.length===1 ? titles[0].value : '', body, imageUrls:images.map(e=>e.src), titleLimit: titles[0]?.maxLength ?? -1, imageCount:images.length, files:[...root.querySelectorAll('input[type="file"]')].flatMap(e=>[...(e.files??[])].map(f=>({name:f.name,size:f.size}))), errors, canPublish:[...root.querySelectorAll('button')].some(e=>e.getBoundingClientRect().height>0&&/^发布$|^发表$|^投稿$/.test(text(e.innerText))), topics: editor ? [...editor.querySelectorAll('a[data-topic],[data-topic],[data-mention="#"],[class*="hashtag"]')].map(e=>{try{return JSON.parse(e.getAttribute('data-topic')).name;}catch{return text(e.textContent);}}) : [], expectedTitle:expected.title };
}
export function verifyGraphicPage(actual, expected) {
  const base=graphicBodyWithoutTags(expected.body,expected.tags),body = compact(base), observed = compact(actual.body);
  const titleOk = compact(actual.title) === compact(expected.title);
  const bodyOk = observed === body || observed === compact([base,...expected.tags.map(t=>`#${t}`)].join('\n'));
  const tagsOk = expected.tags.every(t => actual.topics.some(v=>compact(v).replace(/^#/,'')===t));
  const orderOk = !expected.imageHashes || JSON.stringify(actual.imageHashes) === JSON.stringify(expected.imageHashes);
  return { ready:titleOk&&bodyOk&&tagsOk&&orderOk&&actual.imageCount===expected.imageCount&&actual.canPublish&&!actual.errors.length, titleOk, bodyOk, tagsOk, orderOk, imageCount:actual.imageCount, errors:actual.errors };
}
async function selector(page, options) {
  return page.evaluate(({kind,text})=>{
    const frame=[...document.querySelectorAll('iframe')].find(e=>e.src.includes('/york/read-editor'));const root=frame?.contentDocument??document;
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>3&&r.height>3&&r.right>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0.01&&!e.closest('[aria-hidden="true"]')};
    const path=e=>{const pieces=[];while(e&&e!==root.body){const tag=e.tagName.toLowerCase(),siblings=[...e.parentElement.children].filter(n=>n.tagName===e.tagName);pieces.unshift(`${tag}:nth-of-type(${siblings.indexOf(e)+1})`);e=e.parentElement;}return 'body>'+pieces.join('>')};
    let found=[];
    if(kind==='file') { found=[...root.querySelectorAll('input[type="file"]')].filter(e=>/image|png|jpe?g|webp/i.test(e.accept||'')&&!e.closest('[aria-hidden="true"]')); const multi=found.filter(e=>e.multiple); if(multi.length===1)found=multi; }
    else if(kind==='title')found=[...root.querySelectorAll('input,textarea')].filter(e=>visible(e)&&/标题/.test(e.placeholder||''));
    else if(kind==='body') { found=[...root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea')].filter(e=>visible(e)&&!/标题/.test(e.placeholder||'')); if(found.length>1){const matching=found.filter(e=>/正文|简介|描述|内容/.test(e.getAttribute('data-placeholder')||e.getAttribute('placeholder')||''));if(matching.length)found=matching;} }
    else if(kind==='tab')found=[...root.querySelectorAll('span,button,[role="tab"]')].filter(e=>visible(e)&&e.textContent.trim()===text);
    return found.length===1 ? {selector:path(found[0]),multiple:found[0].multiple??false,value:found[0].value??found[0].innerText??'',maxLength:found[0].maxLength??-1} : null;
  },options);
}
async function runBiliGraphic(page,snapshot,root,dir,previous,operation,save){
  const publication=snapshot.publication;
  let markdown=snapshot.body;
  if(snapshot.html)markdown=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style,head').forEach(e=>e.remove());
    const render=node=>{if(node.nodeType===3)return node.textContent||'';if(node.nodeType!==1)return '';const tag=node.tagName.toLowerCase(),children=[...node.childNodes].map(render).join('');if(tag==='img')return `\n\n![](${node.getAttribute('src')||''})\n\n${node.getAttribute('alt')||''}\n\n`;if(/^h[1-6]$/.test(tag))return `\n\n${'#'.repeat(Number(tag[1]))} ${children}\n\n`;if(tag==='br')return '\n';if(tag==='li')return `\n- ${children}`;if(tag==='strong'||tag==='b')return `**${children}**`;return ['p','div','section','ul','ol','blockquote'].includes(tag)?`\n\n${children}\n\n`:children;};
    return render(doc.body).replace(/\n{3,}/g,'\n\n').trim();
  },snapshot.html);
  if(!/!\[[^\]]*\]\(/.test(markdown))for(const image of snapshot.images){const file=await realpath(join(root,image.file)),rel=relative(root,file);if(isAbsolute(rel)||rel.startsWith('..'))throw new Error('图片超出本项目');const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw new Error('图片文件已变化');const mime=/\.jpe?g$/i.test(file)?'image/jpeg':/\.webp$/i.test(file)?'image/webp':'image/png';markdown+=`\n\n![](data:${mime};base64,${bytes.toString('base64')})`;}
  const importFile=join(dir,'bili-import.md');
  // Embedded data images are the native importer input; Markdown remains task-owned.
  await writeFile(importFile,markdown,{encoding:'utf8'});
  let current=await page.evaluate(inspectGraphicPage,{title:publication.title});
  const expectedBody=markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g,'$1').replace(/^#{1,6}\s+/gm,'').replace(/\*\*|__|`/g,'').replace(/^\s*[-*+]\s+/gm,'').trim();
  const expectedImages=(markdown.match(/!\[[^\]]*\]\(/g)||[]).length;
  if(previous.documentImported)await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].find(e=>e.src.includes('/york/read-editor'))?.contentDocument?.querySelector('.ProseMirror')?.textContent.length>0,undefined,{timeout:30000});
  current=await page.evaluate(inspectGraphicPage,{title:publication.title});
  if(previous.uploadAttempted && compact(current.body)===compact(expectedBody) && current.imageCount===expectedImages) previous.documentImported=true;
  if(operation!=='inspect'&&!previous.documentImported){
    if(current.title||compact(current.body))throw new Error('原编辑器已有其他内容，未覆盖；请核对原任务');
    if(previous.uploadAttempted)throw new Error('上次导入结果未确认，请核对原草稿，未再次导入');
    previous.uploadAttempted=true;await save(previous);
    await page.setInputFiles('input[type="file"][accept=".docx,.md"]',importFile);
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].find(e=>e.src.includes('/york/read-editor'))?.contentDocument?.querySelector('.ProseMirror')?.textContent.length>0,undefined,{timeout:20000});
    const title=await selector(page,{kind:'title'});if(!title)throw new Error('B站标题输入不可用');await page.fill(`loc=css:${title.selector}`,publication.title);
    previous.documentImported=true;await save(previous);
  }
  current=await page.evaluate(inspectGraphicPage,{title:publication.title});
  current.canPublish ||= publishControlInSnapshot(await page.snapshot({scope:'full_page'}));
  const ready=compact(current.title)===compact(publication.title)&&compact(current.body)===compact(expectedBody)&&current.imageCount===expectedImages&&current.canPublish&&!current.errors.length;
  let savedDraft=false;
  if(ready&&operation!=='inspect'){
    await page.click("loc=role:button[name='保存为草稿']",{label:'save article draft'});
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].find(e=>e.src.includes('/york/read-editor'))?.contentDocument?.body.innerText.includes('保存成功'),undefined,{timeout:90000});
    savedDraft=true;
  }
  const remoteId=new URL(await page.url()).searchParams.get('aid');
  return {...previous,ready,documentImported:previous.documentImported,savedDraft:savedDraft||previous.savedDraft===true||Boolean(operation==='inspect'&&remoteId&&ready),...(remoteId?{remoteId}:{}),checkedAt:Date.now(),imageCount:current.imageCount,...(ready?{error:undefined}:{error:'B站正文或图片未全部核对，原编辑器保持；请继续原任务'})};
}
export async function runGraphicPublisher({folder,taskId,operation,snapshotFile,spaceId,pageLabel='p1'}) {
  if(!/^[a-f0-9-]{36}$/i.test(taskId)||!['create','resume','inspect'].includes(operation))throw new Error('Invalid graphic task');
  const root=await realpath(folder),snapshotPath=await realpath(snapshotFile),rel=relative(root,snapshotPath);
  if(isAbsolute(rel)||rel.startsWith('..')||!rel)throw new Error('Snapshot outside project');
  const snapshot=JSON.parse(await readFile(snapshotPath,'utf8')),publication=snapshot.publication,profile=GRAPHIC_PLATFORMS[publication.platform];
  if(!profile)throw new Error('Unsupported graphic platform');
  const dir=join(root,'.dsh-creator-workbench','production',taskId),receiptPath=join(dir,'graphic-receipt.json');
  if((await realpath(dir)).toLowerCase()!==dir.toLowerCase() || (await lstat(dir)).isSymbolicLink())throw new Error('Task directory must be owned');
  let receipt=JSON.parse(await readFile(receiptPath,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
  if(receipt.taskId&&receipt.taskId!==taskId)throw new Error('Receipt mismatch');
  let task,page;
  const save=async(next=receipt)=>{receipt=next;const temp=receiptPath+'.'+Date.now()+'.tmp';await writeFile(temp,JSON.stringify(receipt,null,2),{encoding:'utf8',flag:'wx'});await rename(temp,receiptPath);};
  try {
    const entries=await listTaskSpaces();
    const existing=spaceId ? entries.find(e=>e.id===spaceId) : receipt.spaceId ? entries.find(e=>e.id===receipt.spaceId&&e.name.includes(taskId)) : entries.find(e=>e.name===`creator-graphic-${taskId}`);
    if(existing) { if(existing.ownership==='agent')task=await taskSpace(existing.id);else if(operation!=='create'||spaceId)task=await takeOverTaskSpace(existing.id);else throw new Error('USER_CONTROL: 请继续原任务，不要重新上传'); }
    else {
      // A formatting/preparation failure can happen before the first browser
      // space is recorded. Resume that same local task only at this boundary.
      // Once any page or upload was owned, a lost page requires inspection.
      if(operation==='inspect'||receipt.spaceId||receipt.opened||receipt.uploadAttempted)throw new Error('原图文页面已不在，请先核对平台草稿；未自动另建上传');
      task=await taskSpace(`creator-graphic-${taskId}`);
    }
    const pages=await task.pages();if(!spaceId&&pages.length!==1)throw new Error('图文任务页面不唯一，请核对原任务');page=spaceId?pages.find(p=>p.label===pageLabel):pages[0];if(!page)throw new Error('原图文页面不存在');
    receipt={...receipt,taskId,spaceId:task.spaceId,publicationId:publication.id,revision:publication.revision,platform:publication.platform,accountId:snapshot.accountId};await save();
    if(!receipt.opened){await page.goto(profile.url);receipt.opened=true;await save();}
    await page.waitForFunction(()=>document.body?.innerText.length>100,undefined,{timeout:20000});
    if(!new URL(await page.url()).hostname.endsWith(new URL(profile.url).hostname))throw new Error('页面跳转到其他站点，请核对原任务');
    if(publication.platform==='bilibili'){
      if(!await selector(page,{kind:'title'})){await page.waitForSelector("loc=role:button[name='新的创作']",{timeout:15000});await page.click("loc=role:button[name='新的创作']",{label:'open article editor'});await page.waitForSelector('textarea[placeholder="请输入标题（建议30字以内）"]',{timeout:15000});}
      receipt=await runBiliGraphic(page,snapshot,root,dir,receipt,operation,save);
      await save();
    } else {
    let actual=await page.evaluate(inspectGraphicPage,{title:publication.title});
    if(operation!=='inspect'&&!receipt.uploadAttempted){
      if(profile.maxImages&&snapshot.images.length>profile.maxImages)throw new Error(`此平台最多支持 ${profile.maxImages} 张图片`);
      const files=[];
      for(const image of snapshot.images){const file=await realpath(join(root,image.file));const r=relative(root,file);if(isAbsolute(r)||r.startsWith('..'))throw new Error('图片超出本项目');const hash=createHash('sha256').update(await readFile(file)).digest('hex');if(hash!==image.sha256)throw new Error('图片已变化');files.push(file);}
      let control=await selector(page,{kind:'file'});
      if(!control&&publication.platform==='xiaohongshu'){await page.click("xpath=//div[@data-hp-bound='1']/span[normalize-space()='上传图文']",{label:'open image note'});control=await selector(page,{kind:'file'});}
      if(!control&&profile.tab){const tab=await selector(page,{kind:'tab',text:profile.tab});if(!tab)throw new Error('无法唯一识别图文入口');await page.click(`loc=css:${tab.selector}`,{label:'open image publishing'});control=await selector(page,{kind:'file'});}
      if(!control)throw new Error('未找到唯一的图片上传入口，请核对登录和图文页面');
      if(actual.files.length||actual.title||compact(actual.body))throw new Error('页面已有其他材料，已停止，未覆盖现有内容');
      receipt.uploadAttempted=true;receipt.imageNames=files.map(f=>basename(f));await save();
      if(control.multiple)await page.setInputFiles(`loc=css:${control.selector}`,files);
      else for(const file of files){const current=await selector(page,{kind:'file'});if(!current)throw new Error('图片上传入口变化');await page.setInputFiles(`loc=css:${current.selector}`,file);}
      await page.waitForFunction(()=>[...document.querySelectorAll('input,textarea')].some(e=>/标题/.test(e.placeholder||'')),undefined,{timeout:90000});
      receipt.inputsAssigned=true;await save();actual=await page.evaluate(inspectGraphicPage,{title:publication.title});
    }
    const baseBody=graphicBodyWithoutTags(snapshot.body,publication.tags),body=[baseBody,...publication.tags.map(t=>`#${t}`)].filter(Boolean).join('\n');
    if(operation!=='inspect') {
      const title=await selector(page,{kind:'title'}),editor=await selector(page,{kind:'body'});
      if(!title||!editor)throw new Error('未唯一识别标题和正文编辑区');
      if(title.maxLength>0&&publication.title.length>title.maxLength)throw new Error(`标题超过平台当前 ${title.maxLength} 字限制`);
      if(title.value&&compact(title.value)!==compact(publication.title))throw new Error('平台标题已被修改，请核对后继续');
      const observedBody=compact(actual.body),ownLegacyBody=receipt.bodyWritten&&compact(graphicBodyWithoutTags(actual.body,publication.tags))===compact(baseBody)&&observedBody!==compact(body);
      if(observedBody&&![compact(body),compact(baseBody)].includes(observedBody)&&!ownLegacyBody)throw new Error('平台正文已被修改，原内容保持，请核对后继续');
      if(!title.value)await page.fill(`loc=css:${title.selector}`,publication.title);
      if(ownLegacyBody)await page.fill(`loc=css:${editor.selector}`,'');
      if(!observedBody||ownLegacyBody){await page.focus(`loc=css:${editor.selector}`);const lines=baseBody.split('\n');for(let i=0;i<lines.length;i++){if(i)await page.press(`loc=css:${editor.selector}`,'Enter');if(lines[i])await page.keyboard.insertText(lines[i]);}receipt.bodyWritten=true;await save();}
      for(const tag of publication.tags){
        const observed=await page.evaluate(inspectGraphicPage,{title:publication.title});if(observed.topics.some(value=>compact(value).replace(/^#/,'')===tag))continue;
        await page.focus(`loc=css:${editor.selector}`);await page.press(`loc=css:${editor.selector}`,'Control+End');
        await page.press(`loc=css:${editor.selector}`,'Enter');await page.keyboard.type(`#${tag}`,{delay:100});
        const xhs=publication.platform==='xiaohongshu';
        await page.waitForFunction(({value,xhs})=>[...document.querySelectorAll(xhs?'#creator-editor-topic-container .item .name':'.mention-suggest-mount-dom [class*="tag-hash-view-name-"]')].some(e=>e.textContent.trim()===(xhs?'#':'')+value),{value:tag,xhs},{timeout:15000});
        const topic=await page.evaluate(({value,xhs})=>{const rows=[...document.querySelectorAll(xhs?'#creator-editor-topic-container .item':'.mention-suggest-mount-dom [class*="tag-hash-o"]')];const i=rows.findIndex(e=>(xhs?e.querySelector('.name'):e.querySelector('[class*="tag-hash-view-name-"]'))?.textContent.trim()===(xhs?'#':'')+value);return i<0?null:xhs?`#creator-editor-topic-container .item:nth-child(${i+1})`:`.mention-suggest-mount-dom [class*="tag-hash-o"]:nth-child(${i+1})`;},{value:tag,xhs});
        if(!topic)throw new Error(`未找到准确话题：${tag}`);await page.click(topic,{label:'select exact topic'});await save();
      }
    }
    actual=await page.evaluate(inspectGraphicPage,{title:publication.title});
    actual.canPublish ||= publishControlInSnapshot(await page.snapshot({scope:'full_page'}));
    actual.imageHashes=actual.imageUrls.map(value=>{const url=new URL(value);return createHash('sha256').update(url.origin+url.pathname).digest('hex');});
    if(receipt.inputsAssigned&&!receipt.imageOrder&&actual.imageCount===snapshot.images.length){receipt.imageOrder=actual.imageHashes;await save();}
    const verdict=verifyGraphicPage(actual,{title:publication.title,body:snapshot.body,tags:publication.tags,imageCount:snapshot.images.length,...(receipt.imageOrder?{imageHashes:receipt.imageOrder}:{})});
    receipt={...receipt,...verdict,savedDraft:false,checkedAt:Date.now(),url:await page.url(),error:verdict.ready?undefined:'图文材料尚未全部核对，请继续原任务；未点击发表'};await save();
    }
  } catch(error) { receipt={...receipt,taskId,ready:false,error:String(error.message||error),checkedAt:Date.now()};await save(); }
  finally {
    // Ego may terminate this round at handOff; emit the persisted result first.
    console.log('CREATOR_GRAPH:'+JSON.stringify({ready:receipt.ready===true,savedDraft:receipt.savedDraft===true,...(receipt.remoteId?{remoteId:receipt.remoteId}:{}),userControl:/USER_CONTROL|permission|not assigned|paused/i.test(receipt.error||''),receipt:relative(root,receiptPath),...(receipt.error?{error:receipt.error}:{})}));
    if(task)await task.handOff();
  }
}
