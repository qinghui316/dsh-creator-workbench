import { spawn } from "node:child_process";
import { accountScript, ACCOUNT_MARKER } from "./ego-account.mjs";
import { legacyEgoPrelude, protectPublisherDrafts } from "./ego-compat.mjs";
import { adaptDouyinSource } from "./publisher-douyin-adapter.mjs";
import { adaptBilibiliSource } from "./publisher-bilibili-adapter.mjs";

function run(script) {
  return new Promise((resolve, reject) => {
    const command = process.env.CREATOR_EGO_EXECUTABLE;
    if (!command) return reject(new Error("浏览器命令尚未配置。"));
    const child = spawn(command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out=[], err=[]; child.stdout.on("data",b=>out.push(b)); child.stderr.on("data",b=>err.push(b));
    child.once("error",reject); child.once("close",code=>resolve({code,stdout:Buffer.concat(out),stderr:Buffer.concat(err)}));
    child.stdin.on("error",()=>{}); child.stdin.end(script);
    const stop=()=>child.kill(); process.once("SIGTERM",stop); process.once("SIGINT",stop);
    child.once("close",()=>{process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop);});
  });
}
try {
  const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
  const script=Buffer.concat(chunks).toString("utf8");
  if (!script || script.length>16*1024*1024) throw new Error("上传操作无效。");
  const platform=process.env.CREATOR_PUBLISH_PLATFORM, expectedId=process.env.CREATOR_PUBLISH_ACCOUNT;
  if (!expectedId) throw new Error("上传任务没有绑定账号。");
  const check=await run(accountScript(platform,{expectedId}));
  if(check.code!==0 || !Buffer.concat([check.stdout,check.stderr]).includes(ACCOUNT_MARKER)) throw new Error("当前登录账号无法核验；上传已暂停，请检查账号。");
  const resumeSpace=process.env.CREATOR_RESUME_SPACE ? Number(process.env.CREATOR_RESUME_SPACE) : undefined;
  const result=await run(legacyEgoPrelude({resumeSpace})+adaptBilibiliSource(platform,adaptDouyinSource(platform,protectPublisherDrafts(platform,script)))); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode=result.code??1;
} catch { console.error("上传前账号核验未通过，未执行本次浏览器操作。"); process.exitCode=1; }
