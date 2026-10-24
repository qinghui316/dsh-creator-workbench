import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mediaCommand } from "../src/covers/files.ts";
import { saveImageSettings } from "../src/covers/provider.ts";
import { generateImageItems, reconcileImageItems } from "../src/production/imageTasks.ts";
import { owned, readState, updateState } from "../src/production/storage.ts";
import type { ProductionTask } from "../src/production/types.ts";
let picture: Buffer; const servers: Server[] = [];
beforeAll(async () => { const dir=await mkdtemp(join(tmpdir(),"creator-image-task-")),file=join(dir,"source.png"); await mediaCommand("ffmpeg",["-v","error","-f","lavfi","-i","color=red:s=240x320","-frames:v","1",file]); picture=await readFile(file); },15000);
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
async function fixture(){
 const folder=await mkdtemp(join(tmpdir(),"creator-multi-image-")),dataDir=join(folder,"settings"); let failing=true;const calls:string[]=[];
 const server=createServer((req,res)=>{let body="";req.on("data",part=>body+=part);req.on("end",()=>{const input=JSON.parse(body);calls.push(input.prompt);if(failing&&input.prompt==="second"){res.writeHead(400);res.end("unsupported");}else res.end(JSON.stringify({data:[{b64_json:picture.toString("base64")}]}));});});servers.push(server);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 await saveImageSettings(dataDir,{apiBase:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:"fixture"});
 const task:ProductionTask={id:randomUUID(),contentId:"episode",folderPath:folder,kind:"images",status:"running",createdAt:1,updatedAt:1,imageItems:["first","second"].map(prompt=>({id:randomUUID(),prompt,ratio:"3x4",purpose:"card",references:[],status:"pending"}))};
 await updateState(folder,s=>{s.tasks.push(task);});
 return{folder,dataDir,task,calls,signal:new AbortController().signal,changed:()=>undefined,succeed:()=>{failing=false;}};
}
describe("ordered image generation and recovery",()=>{
 it("retains a complete image after another fails and retries only the selected item",async()=>{
  const f=await fixture();await generateImageItems({...f,key:"private-fixture"});let state=await readState(f.folder);
  expect(state.images).toHaveLength(1);expect(state.tasks[0]!.imageItems!.map(i=>i.status)).toEqual(["completed","failed"]);const first=state.images![0]!;
  f.succeed();await generateImageItems({...f,key:"private-fixture",task:state.tasks[0]!,itemIds:[f.task.imageItems![1]!.id]});state=await readState(f.folder);
  expect(f.calls).toEqual(["first","second","second"]);expect(state.images).toHaveLength(2);expect(state.tasks[0]!.status).toBe("completed");expect(await readFile(join(f.folder,first.file))).toEqual(picture);
 });
 it("recovers a fully written image after interruption without a new remote request",async()=>{
  const f=await fixture(),id=randomUUID(),slot=f.task.imageItems![0]!;slot.status="running";slot.imageId=id;
  const dir=await owned(f.folder,"images",id);await writeFile(join(dir,"image.png"),picture);await updateState(f.folder,s=>{s.tasks[0]!.imageItems=f.task.imageItems!;});
  await reconcileImageItems(f.folder,f.task);const state=await readState(f.folder);expect(state.images?.[0]?.id).toBe(id);expect(state.tasks[0]!.imageItems![0]!.status).toBe("completed");expect(f.calls).toEqual([]);
  expect(state.tasks[0]!.imageItems![1]!.status).toBe("cancelled");expect(state.tasks[0]!.status).toBe("failed");
 });
 it("marks an interrupted request without a complete file as unknown",async()=>{
  const f=await fixture();f.task.imageItems![0]!.status="running";await updateState(f.folder,s=>{s.tasks[0]!.imageItems=f.task.imageItems!;});
  await reconcileImageItems(f.folder,f.task);expect((await readState(f.folder)).tasks[0]!.imageItems![0]!.status).toBe("unconfirmed");expect(f.calls).toEqual([]);
 });
});
