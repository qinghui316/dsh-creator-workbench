import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {describe,it,expect} from "vitest";
const script=await readFile("scripts/collect-publish.mjs","utf8");
function operations(){const context={process:{env:{}},OIL_COLLECT_TARGETS:[{title:"",remoteIds:["822570744973099032","205918405964298199"]}],result:undefined as unknown};vm.runInNewContext(script.split("const keepSpace =")[0]+"\nglobalThis.result={parseBiliOpusPayload,foundTargets};",context);return context.result as {parseBiliOpusPayload:(p:unknown)=>Array<Record<string,unknown>>;foundTargets:(p:unknown[])=>boolean};}
describe("published Bili graphic collection",()=>{
 it("keeps large work IDs exact and distinguishes unknown metrics from zero and unpublished works",()=>{
  const api=operations(),items=api.parseBiliOpusPayload({code:0,data:{items:[{dyn_id:"822570744973099032",title:"已发表图文",filter_group:{filter_type:2,timing_waiting_pub:"0"},stat:{view:"139",like:"-",reply:"0"}},{dyn_id:"205918405964298199",title:"另一图文",filter_group:{filter_type:2},stat:{view:"8",like:"1",reply:"-"}},{dyn_id:"123",title:"未发表",filter_group:{filter_type:1},stat:{view:"0"}}]}});
  expect(items).toHaveLength(2);expect(items[0]).toMatchObject({remoteId:"822570744973099032",views:139,comments:0});expect(items[0]).not.toHaveProperty("likes");expect(items[1]).toMatchObject({views:8,likes:1});expect(api.foundTargets([items[0]!])).toBe(false);expect(api.foundTargets(items)).toBe(true);
 });
});
