import { selectValue } from "./helpers/selectValue.ts";
// @vitest-environment jsdom
import {createElement as h} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {ProductionPanel} from '../src/client/ProductionPanel.tsx';
import type {ProductionClient} from '../src/client/productionApi.ts';
import type {ContentDetail} from '../src/types.ts';
import {emptyProduction,type ProductionSettingsView,type ProductionAction} from '../src/production/types.ts';
import {emptyPublish} from '../src/publishRules.ts';
vi.mock('@deepseek-ai/dsh-client-ui-primitives',()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h('button',props,children as never)}));
afterEach(cleanup);
let sequence=0;
async function fixture() {
 const settings:ProductionSettingsView={revision:'one',accounts:{bilibili:{platform:'bilibili',id:'account',name:'创作者',checkedAt:1}},accountHistory:[],observations:{},browserPaused:false,wechat:{appid:'',author:'',theme:'claude-editorial'},runtime:{publisher:true,article:true,python:true,ffmpeg:true,browser:true,details:[]},asrConfigured:false,wechatConfigured:false,wechatCredential:'ref'};
 const action=vi.fn(async(_request:ProductionAction)=>emptyProduction());
 const api={settings:async()=>settings,state:async()=>emptyProduction(),action} as unknown as ProductionClient;
 const detail:ContentDetail={id:'episode',folderPath:`C:/fixture/episode-${++sequence}`,title:'本期视频',tags:[],covers:{},videoSelection:'selected',selectedVideo:'成片.mp4',videos:[{name:'成片.mp4',path:'C:/fixture/成片.mp4',size:100,modifiedAt:1}],recordedAt:0,createdMs:0,subtitles:{},hasPublishPackage:false,hasArticle:false,pipeline:'raw',workflow:'finish',publish:emptyPublish(),burn:{status:'idle'},subtitleJob:{status:'idle'},coverJob:{status:'idle'},publishCopy:'',topicNote:'',script:'',article:'',secrets:{subtitle:{kind:'subtitle',ref:'subtitle',configured:false,writable:true},cover:{kind:'cover',ref:'cover',configured:false,writable:true}}};
 render(h(ProductionPanel,{detail,api,mode:'publishing',openPath:vi.fn(),enabledPlatforms:['bilibili']}));
 const form=within(screen.getByText('准备上传').closest('details')!);
 selectValue(form.getByLabelText('平台'), 'bilibili');
 await form.findByLabelText('B站分区');
 fireEvent.click(form.getByLabelText('我确认本次视频可按原创上传'));
 await waitFor(()=>expect((form.getByText('上传并准备草稿') as HTMLButtonElement).disabled).toBe(false));
 return {form,action,api,detail,settings};
}
describe('Bilibili upload category input',()=>{
 it('keeps synchronization available after user cancellation and puts its technical result in details',async()=>{
  const {api,detail}=await fixture();cleanup();
  api.state=async()=>({...emptyProduction(),tasks:[{id:'cancelled-sync',contentId:detail.id,folderPath:detail.folderPath,createdAt:1,updatedAt:2,kind:'metrics',status:'cancelled',error:'bilibili: 用户取消任务。',metricsTargets:[{platform:'bilibili',accountId:'account'}]}]});
  render(h(ProductionPanel,{detail,api,mode:'publishing',openPath:vi.fn(),enabledPlatforms:['bilibili']}));
  await screen.findByRole('button',{name:'任务详情'});
  expect((screen.getByRole('button',{name:'同步数据'}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'任务详情'}));
  expect(screen.getByText('bilibili: 用户取消任务。')).toBeTruthy();
 });
 it('sends the explicit visible category with the material snapshot',async()=>{
  const {form,action}=await fixture();fireEvent.change(form.getByLabelText('B站分区'),{target:{value:' 知识 '}});
  fireEvent.click(form.getByText('上传并准备草稿'));
  await waitFor(()=>expect(action).toHaveBeenCalledWith(expect.objectContaining({action:'upload',input:expect.objectContaining({platform:'bilibili',category:'知识'})})));
 });
 it('leaves the category absent when the user chooses platform recommendation',async()=>{
  const {form,action}=await fixture();fireEvent.click(form.getByText('上传并准备草稿'));
  await waitFor(()=>expect(action).toHaveBeenCalledOnce());
  expect(action.mock.calls[0]?.[0]).toEqual(expect.objectContaining({input:expect.not.objectContaining({category:expect.anything()})}));
 });
 it('keeps an active upload visible when a later metrics task has completed',async()=>{
  const {api,detail,settings}=await fixture();cleanup();
  const scope={contentId:detail.id,folderPath:detail.folderPath,createdAt:1,updatedAt:1};
  api.state=async()=>({...emptyProduction(),tasks:[{...scope,id:'upload-one',kind:'upload',status:'running',platform:'bilibili'},{...scope,id:'sync-two',kind:'metrics',status:'completed'}]});
  render(h(ProductionPanel,{detail,api,mode:'publishing',openPath:vi.fn(),enabledPlatforms:['bilibili']}));
  await screen.findByText('视频上传 · B站');
  expect(screen.getByRole('button',{name:'取消'})).toBeTruthy();
 });
 it('updates an asynchronously loaded association platform before submitting',async()=>{
  const {api,detail,action}=await fixture();cleanup();
  const view=render(h(ProductionPanel,{detail,api,mode:'publishing',openPath:vi.fn(),enabledPlatforms:[]}));
  view.rerender(h(ProductionPanel,{detail,api,mode:'publishing',openPath:vi.fn(),enabledPlatforms:['bilibili']}));
  fireEvent.click(screen.getByRole('button',{name:'关联作品'}));
  await act(async()=>{});
  await waitFor(()=>expect((screen.getAllByRole('combobox',{name:'平台'}).at(-1) as HTMLSelectElement).value).toBe('bilibili'));
  fireEvent.change(screen.getByLabelText('平台作品标识'),{target:{value:'BV12345'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'关联并读取数据'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'关联并读取数据'}));
  await waitFor(()=>expect(action).toHaveBeenCalledWith(expect.objectContaining({action:'associate-publication',platform:'bilibili',expectedAccountId:'account'})));
 });

});
