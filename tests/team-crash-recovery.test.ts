import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";

it("survives SIGKILL after one durable result without paying for either child again", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-crash-"));
  const fixture = path.join(root, "runner.mjs");
  const imports = Object.fromEntries(["agent-service", "agent-session-store", "learning-application", "team-contracts"].map(name => [name, new URL(`../src/${name}.ts`, import.meta.url).href]));
  await fs.writeFile(fixture, `
import fs from 'node:fs/promises'; import path from 'node:path';
import { AgentService } from ${JSON.stringify(imports["agent-service"])};
import { AgentSessionStore } from ${JSON.stringify(imports["agent-session-store"])};
import { LearningApplication } from ${JSON.stringify(imports["learning-application"])};
import { teamConfigurationSchema } from ${JSON.stringify(imports["team-contracts"])};
const root=process.argv[2], resume=process.argv[3];
const app=await LearningApplication.open(root, process.cwd());
let members=0; let session;
const client={async *stream(prompt, signal, options) {
  const system=options?.messages?.filter(item=>item.role==='system').map(item=>item.content).join(' ');
  const kind=system?.includes('TEAM_PLAN')?'plan':system?.includes('TEAM_MEMBER')?'member':'answer';
  await fs.appendFile(path.join(root,'calls.jsonl'), JSON.stringify({kind})+'\\n');
  if(kind==='member' && ++members===2) {
    process.send({ready:true,sessionId:session.id,taskId:service.activeTaskId});
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();
  }
  yield {type:'text_delta',text:kind==='plan'?'{"tasks":["核查计算","检查条件"]}':kind==='member'?'成员一已完成独立核查。':'主 Agent 保留已有结论，并明确成员二未完成。'};
  yield {type:'usage',usage:{inputTokens:10,outputTokens:20}};yield {type:'done'};
}};
const store=new AgentSessionStore(path.join(root,'chats'));const service=new AgentService(store,()=>client,app);
try {
  session=resume?await store.load(resume):await service.create();
  const previous=session.messages.at(-1);
  await service.invoke({sessionId:session.id,provider:'mock',style:'adaptive',text:resume?'继续':'合成测试，请核查计算',topicId:'rag',resumeTaskId:previous?.taskId,collaboration:teamConfigurationSchema.parse({mode:'same-model-team',maxConcurrency:1})});
  await service.pauseMaintenance();
  await fs.writeFile(path.join(root,'recovered.json'),JSON.stringify((await store.load(session.id)).messages.at(-1)));
} finally {service.stop();await service.idle();await service.pauseMaintenance();app.close();}
`);
  const launch = (id?: string) => fork(fixture, [root, ...(id ? [id] : [])], { cwd: process.cwd(), execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
  const child = launch(); let next: ReturnType<typeof fork> | undefined;
  try {
    const ready = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("fixture_exited_early"); }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("fixture_timeout")), 10_000); timer.unref(); })]);
    const id = (ready[0] as { sessionId: string }).sessionId; expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    next = launch(id); const [code] = await once(next, "exit"); expect(code).toBe(0);
    const calls = (await fs.readFile(path.join(root, "calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line).kind);
    expect(calls).toEqual(["plan", "member", "member", "answer"]);
    const recovered = JSON.parse(await fs.readFile(path.join(root, "recovered.json"), "utf8"));
    expect(recovered.status).toBe("blocked"); expect(recovered.team.status).toBe("partial");
    expect(recovered.team.members.map((member: { status: string }) => member.status)).toEqual(["completed", "interrupted"]);
    expect(recovered.team.modelTurns).toBe(4); expect(recovered.team.unknownUsageRequests).toBe(1);
  } finally { child.kill(); next?.kill(); await fs.rm(root, { recursive: true, force: true }); }
}, 20_000);
