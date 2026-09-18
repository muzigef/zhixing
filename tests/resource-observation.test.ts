import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mcpObservation, resourceObservationState } from "../src/resource-observation.js";
import { ToolHarness } from "../src/tool-harness.js";
import { z } from "zod/v4";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { McpSettings } from "../src/mcp-settings.js";
import type { ContinuableModelClient } from "../src/model.js";
const policy = { name:"read", risk:"read" as const, replaySafe:true, observation:{identity:"id",resultIdentity:"id",version:"revision"} }, resource="mcp:rag:fixture";
const response = (id: string, revision: unknown) => ({content:[],structuredContent:{id,revision}});
it("only accepts explicit resource-bound structured versions, not errors or prose", () => {
  const observation = mcpObservation(policy, resource);
  expect(observation.observe!({id:"A"}, response("A","v1"))).toBeDefined();
  for (const output of [{content:[{type:"text",text:"revision v2"}]}, {...response("A","v1"), isError:true}, response("B","v1"), response("A",{}), response("A"," ")]) expect(observation.observe!({id:"A"}, output)).toBeUndefined();
  expect(mcpObservation({...policy,observation:undefined},resource).observe).toBeUndefined();
});
it("preserves observed versions in real harness receipts, independently of output text", async () => {
  const harness = new ToolHarness(); let revision="v1", noise=0;
  harness.register({name:"read",resource,input:z.object({id:z.string()}),risk:"read",idempotent:true,timeoutMs:1000,...mcpObservation(policy,resource),execute:async ({id}) => ({...response(id,revision), noise:++noise})});
  const call=async(id:string) => ({tool:"read",result:await harness.execute("read",{id},{topicId:"rag",signal:new AbortController().signal})});
  const records=[await call("A")], scope=harness.observationScope("read",{id:"A"}); const first=resourceObservationState(records,()=>resource,scope);
  records.push(await call("A")); expect(resourceObservationState(records,()=>resource,scope)).toBe(first);
  revision="v2"; records.push(await call("B")); expect(resourceObservationState(records,()=>resource,scope)).toBe(first);
  records.push(await call("A")); expect(resourceObservationState(records,()=>resource,scope)).not.toBe(first);
  expect(resourceObservationState(JSON.parse(JSON.stringify(records)),()=>resource,scope)).toBe(resourceObservationState(records,()=>resource,scope));
  expect(resourceObservationState(records,()=>"mcp:other:fixture",scope)).toBe("");
});
const cleanup:(()=>Promise<void>)[]=[]; afterEach(async()=>{for(const close of cleanup.splice(0).reverse()) await close();});
it.each([false,true])("uses persisted external versions in the real agent loop (changed=%s)", async changed => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"zhixing-observation-")), app=await LearningApplication.open(root,process.cwd());
  cleanup.push(async()=>{app.close(); await fs.rm(root,{recursive:true,force:true});});
  const versions=path.join(root,"version.txt"),record=path.join(root,"reads.jsonl"); await fs.writeFile(versions,"v1");
  new McpSettings(app.database).replace("rag",0,[{id:"fixture",enabled:true,consent:"local-process-and-topic-inputs",command:process.execPath,args:[path.resolve("tests/fixtures/mcp-observation-server.mjs"),versions,record],tools:[{...policy,observation:{...policy.observation,version:"version"}}]}]);
  let calls=0;
  const client:ContinuableModelClient={async *stream(){yield {type:"tool_call",tool:"discover_tools",input:{category:"external"},callId:"discover"}; yield {type:"done"};},async *continue(_prompt,_results,_signal,options){
    calls++; if(calls===3 && changed) await fs.writeFile(versions,"v2");
    if(calls<=4) yield {type:"tool_call",tool:options!.tools!.find(tool=>tool.name.startsWith("mcp_fixture_read_"))!.name,input:{id:"A",...(calls===3?{detail:true}:{})},callId:`read-${calls}`};
    else yield {type:"text_delta",text:"已读取这份合成记录，版本观测已保存。"}; yield {type:"done"};
  }};
  const service=new AgentService(new AgentSessionStore(path.join(root,"sessions")),()=>client,app); cleanup.push(async()=>{service.stop();await service.idle();await service.pauseMaintenance();});
  const session=await service.create(); await service.send({sessionId:session.id,provider:"mock",style:"adaptive",topicId:"rag",contextAllowed:true,text:"查询合成资源"}); await service.idle();
  const reads=(await fs.readFile(record,"utf8")).trim().split("\n"); expect(reads).toHaveLength(changed?4:3);
  const message=(await service.load(session.id)).messages.at(-1)!; expect(message.status).toBe(changed?"completed":"failed");
  if(!changed) expect(message.error).toContain("重复执行没有取得进展");
});
