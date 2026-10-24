import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectQuery } from "../src/client/projectQuery.ts";
import { emptyProduction } from "../src/production/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
afterEach(()=>vi.useRealTimers());
describe("shared project queries",()=>{
 it("merges concurrent reads, ignores an older read after mutation, and does not poll when idle",async()=>{
  vi.useFakeTimers(); let done!:(s:ReturnType<typeof emptyProduction>)=>void;
  const state=vi.fn(()=>new Promise<ReturnType<typeof emptyProduction>>(r=>{done=r;}));
  const api={state,settings:vi.fn()} as unknown as ProductionClient,q=new ProjectQuery(api,{id:"one",folderPath:"C:/one"});
  const a=q.refresh(),b=q.refresh();expect(a).toBe(b);const newer={...emptyProduction(),publications:[],articles:[{id:"new",file:"new.md",createdAt:1,frameFiles:[]}]};q.accept(newer);done(emptyProduction());await a;expect(q.snapshot.state).toEqual(newer);
  await vi.advanceTimersByTimeAsync(10000);expect(state).toHaveBeenCalledOnce();expect(api.settings).not.toHaveBeenCalled();
 });
 it("uses one active-task timer and cached settings across subscribers",async()=>{
  vi.useFakeTimers();const running={...emptyProduction(),tasks:[{id:"t",kind:"images" as const,status:"running" as const,contentId:"one",folderPath:"C:/one",createdAt:1,updatedAt:1}]};
  const state=vi.fn(async()=>running),settings=vi.fn(async()=>({})),reconcile=vi.fn(async()=>undefined);
  const q=new ProjectQuery({state,settings,reconcile} as unknown as ProductionClient,{id:"one",folderPath:"C:/one"});
  const stop1=q.subscribe(()=>{}),stop2=q.subscribe(()=>{});await vi.advanceTimersByTimeAsync(1);await Promise.all([q.settings(),q.settings()]);
  expect(reconcile).toHaveBeenCalledOnce();expect(state).toHaveBeenCalledOnce();expect(settings).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(2000);expect(state).toHaveBeenCalledTimes(2);expect(settings).toHaveBeenCalledOnce();
  stop1();stop2();await vi.advanceTimersByTimeAsync(10000);expect(state).toHaveBeenCalledTimes(2);
 });
 it("can retry recovery after the first attempt fails",async()=>{
  const reconcile=vi.fn().mockRejectedValueOnce(new Error("断连")).mockResolvedValue(undefined),state=vi.fn(async()=>emptyProduction());
  const q=new ProjectQuery({state,reconcile} as unknown as ProductionClient,{id:"one",folderPath:"C:/recovery"});const stop=q.subscribe(()=>{});
  await new Promise(r=>setTimeout(r,0));expect(q.snapshot.error).toBe("断连");await q.retry();expect(q.snapshot.error).toBeUndefined();expect(reconcile).toHaveBeenCalledTimes(2);stop();
 });
});
