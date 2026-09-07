import { AgentService } from "../../src/agent-service.js";
import { AgentSessionStore } from "../../src/agent-session-store.js";
import { AgentExecutionStore } from "../../src/agent-execution-store.js";
import { LearningApplication } from "../../src/learning-application.js";
import type { ContinuableModelClient } from "../../src/model.js";
import path from "node:path";
const [root, sessionId, boundary] = process.argv.slice(2);
if (!root || !path.basename(root).startsWith("zhixing-journal-crash-") || !sessionId) throw new Error("fixture_invalid");
const app = await LearningApplication.open(root, process.cwd());
const waitForKill = () => { process.send?.("ready"); return new Promise<never>(() => undefined); };
const save = AgentExecutionStore.prototype.save;
AgentExecutionStore.prototype.save = function (...args) {
  save.apply(this, args);
  if (args[1] === boundary) { process.send?.("ready"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
};
if (boundary === "side_effect") {
  const submit = app.submitEvidence.bind(app);
  app.submitEvidence = async (...args) => { await submit(...args); return waitForKill(); };
}
const client: ContinuableModelClient = {
  async *stream() { for (const value of [41, 42]) yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: `export const answer = ${value};` }, callId: `save${value}` }; yield { type: "done" }; },
  async *continue() { throw new Error("fixture_missed_boundary"); yield { type: "done" }; },
};
const service = new AgentService(new AgentSessionStore(path.join(root, "chats")), () => client, app);
await service.send({ sessionId, text: "保存两个合成实现", provider: "deepseek-api", style: "adaptive", topicId: "agent-development", contextAllowed: true, execution: "session" }); await service.idle();
app.close();
