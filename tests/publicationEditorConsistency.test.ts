// @vitest-environment jsdom
import{createElement as h}from'react';
import{act,cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';
import{afterEach,it,expect,vi}from'vitest';
import{PublicationEditors}from'../src/client/publicationAutosave.ts';
import{PublicationEditorPanel}from'../src/client/PublicationEditorPanel.tsx';
import{ImagePreviewProvider}from'../src/client/ImagePreview.tsx';
import{emptyProduction}from'../src/production/types.ts';
vi.mock('@deepseek-ai/dsh-client-ui-primitives',()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h('button',props,children as never)}));
afterEach(cleanup);
let sequence=0;
function setup(){const detail={id:'p',folderPath:`E:/final-review-${++sequence}`,title:'p',tags:[],covers:{},publish:{},videos:[]}as any;
 const input={platform:'xiaohongshu'as const,type:'images'as const,title:'title',body:'body',imageIds:['b','a'],tags:['旧话题']};
 const publication={...input,id:'pub',bodyFile:'body.md',revision:1,createdAt:1,updatedAt:1};
 const images=['a','b','c'].map(id=>({id,file:id+'.png',mime:'image/png',width:300,height:400,sha256:id,source:'imported'as const,purpose:'card'as const,createdAt:1}));
 const state={...emptyProduction(),images,publications:[publication]};
 const api={state:async()=>state,image:async()=>({mime:'image/png',base64:'YWJj'}),action:vi.fn(async()=>state)}as any;
 const manager=new PublicationEditors(detail.folderPath,vi.fn());const editor=manager.open(publication);
 render(h(ImagePreviewProvider,null,h('div',{'data-surface':'inspector'},h(PublicationEditorPanel,{editor,manager,detail,api,accountId:'A',onRemoved:()=>{}}))));return{editor,publication};}
it('reflects clean adopted Agent tags in the visible tag field',async()=>{const f=setup();await screen.findByLabelText('话题／标签');expect((screen.getByLabelText('话题／标签')as HTMLInputElement).value).toBe('旧话题');
 await act(async()=>f.editor.acceptRemote({...f.publication,revision:2,tags:['新话题']}));
 expect(f.editor.getSnapshot().input.tags).toEqual(['新话题']);expect((screen.getByLabelText('话题／标签')as HTMLInputElement).value).toBe('新话题');
});
it('views the selected ordered publication images rather than unused project images',async()=>{setup();await waitFor(()=>expect((screen.getByRole('button',{name:'放大第1张图片'})as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'放大第1张图片'}));const dialog=screen.getByRole('dialog');expect(dialog.textContent).toContain('1 / 2');
});

import {PublicationPanel} from '../src/client/PublicationPanel.tsx';
it('does not present account A metrics as current while account settings already show B',async()=>{
 const detail={id:'p',folderPath:'E:/final-review-accounts',title:'p',tags:[],covers:{},publish:{},videos:[]}as any;
 const p={id:'pub',platform:'xiaohongshu'as const,type:'images'as const,title:'publication',body:'body',tags:[],imageIds:[],bodyFile:'body.md',revision:1,createdAt:1,updatedAt:1};
 const state={...emptyProduction(),publications:[p],records:[{id:'rA',publicationId:'pub',revision:1,platform:'xiaohongshu'as const,type:'images'as const,accountId:'A',remoteId:'workA',state:'published'as const,updatedAt:1}],metrics:[{platform:'xiaohongshu'as const,accountId:'A',remoteId:'workA',recordId:'rA',publicationId:'pub',views:777,state:'ok'as const,checkedAt:1}]};
 const settings={revision:'B-revision',accounts:{xiaohongshu:{id:'B',name:'账号B',platform:'xiaohongshu',checkedAt:1}},accountHistory:[],observations:{},wechat:{appid:'',theme:'claude-editorial',author:''},wechatConfigured:false};
 const view={detail,production:state,covers:{versions:[],runs:[],selected:{}},script:{exists:false,excerpt:''},settingsRevision:'A-revision',accountIds:{xiaohongshu:'A'}};
 const api={projectView:async()=>view,state:async()=>state,settings:async()=>settings,publication:async()=>p,action:vi.fn(async()=>state)}as any;
 render(h(ImagePreviewProvider,null,h(PublicationPanel,{detail,api,enabledPlatforms:['xiaohongshu']})));
 await screen.findByText('账号B');await screen.findByText('播放／阅读 777 · 赞 — · 评论 —');
 expect(screen.getByText('历史账号 · workA')).toBeTruthy();
});

it.each([['bilibili','images'],['xiaohongshu','video']] as const)('keeps old upload and record ownership after platform/type changes (%s/%s)',async(platform,type)=>{
 const detail={id:'p',folderPath:`E:/final-review-legacy-${platform}-${type}`,title:'p',tags:[],covers:{},publish:{},videos:[]}as any;
 const p={id:'moved-pub',platform,type,title:'current material',body:'body',tags:[],imageIds:[],bodyFile:'body.md',revision:2,createdAt:1,updatedAt:2};
 const state={...emptyProduction(),publications:[p],tasks:[{id:'old-xhs-task',kind:'upload'as const,status:'blocked'as const,step:'原小红书上传待继续',contentId:'p',folderPath:detail.folderPath,platform:'xiaohongshu'as const,publicationId:'moved-pub',publicationType:'images'as const,publicationRevision:1,account:{id:'A',name:'A',platform:'xiaohongshu'as const,checkedAt:1},createdAt:1,updatedAt:1}],records:[{id:'old-xhs-task',publicationId:'moved-pub',revision:1,platform:'xiaohongshu'as const,type:'images'as const,accountId:'A',remoteId:'old-XHS-work',taskId:'old-xhs-task',state:'uploaded'as const,updatedAt:1}]};
 const settings={revision:'r',accounts:{xiaohongshu:{id:'A',name:'小红书账号A',platform:'xiaohongshu',checkedAt:1},bilibili:{id:'B',name:'B站账号B',platform:'bilibili',checkedAt:1}},accountHistory:[],observations:{},wechat:{appid:'',theme:'claude-editorial',author:''},wechatConfigured:false};
 const api={state:async()=>state,settings:async()=>settings,publication:async()=>p,action:vi.fn(async()=>state)}as any;
 render(h(ImagePreviewProvider,null,h(PublicationPanel,{detail,api,enabledPlatforms:['xiaohongshu','bilibili']})));
 await screen.findByText('小红书账号A');expect(screen.getByText('原小红书上传待继续')).toBeTruthy();expect(screen.getByText('图文 · old-XHS-work')).toBeTruthy();
});
