import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { McpSettings } from "../src/mcp-tools.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import type { ContinuableModelClient, ModelClient, ToolResultMessage } from "../src/model.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(client: ModelClient) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-architecture-"));
  const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app);
  cleanup.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const session = await service.create();
  return { root, app, service, session, request: { sessionId: session.id, provider: "mock" as const, style: "adaptive" as const, topicId: "rag", contextAllowed: true, text: "合成任务" } };
}
it("locks both dependency trees to portable HTTPS public registry tarballs", async () => {
  for (const file of ["package-lock.json", "desktop/package-lock.json"]) {
    const lock = JSON.parse(await fs.readFile(file, "utf8")) as { packages: Record<string, { resolved?: string }> };
    const invalid = Object.values(lock.packages).flatMap(item => item.resolved && !item.resolved.startsWith("https://registry.npmjs.org/") ? [item.resolved] : []);
    expect(invalid, file).toEqual([]);
  }
});
it.each([false, true])("allows MCP read after write while still stopping an unchanged third read (%s)", async repeated => {
  let stage = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield { type: "tool_call", tool: "discover_tools", input: { category: "external" }, callId: "discover" }; yield { type: "done" }; },
    async *continue(_prompt, _results, _signal, options) {
      stage++;
      if (stage <= (repeated ? 4 : 3)) {
        const remote = stage === 2 ? "write" : "echo";
        const tool = options!.tools!.find(item => item.name.startsWith(`mcp_fixture_${remote}_`))!;
        yield { type: "tool_call", tool: tool.name, input: { text: stage === 2 ? "updated" : "same resource" }, callId: `call-${stage}` };
      } else yield { type: "text_delta", text: "已读取、修改并重新核对。" };
      yield { type: "done" };
    },
  };
  const { root, app, service, session, request } = await fixture(client); const record = path.join(root, "calls.jsonl");
  new McpSettings(app.database).replace("rag", 0, [{ id: "fixture", enabled: true, consent: "local-process-and-topic-inputs", command: process.execPath, args: [path.resolve("tests/fixtures/mcp-server.mjs"), "modern", record], tools: [{ name: "echo", risk: "read", replaySafe: true }, { name: "write", risk: "write", replaySafe: false }] }]);
  await service.send({ ...request, execution: "session" }); await service.idle();
  const approval = (await service.load(session.id)).messages.at(-1)!.items!.find(item => item.kind === "approval")!;
  await service.answerInteraction(session.id, approval.id, "allow"); await service.idle();
  const message = (await service.load(session.id)).messages.at(-1)!;
  expect(message.status).toBe(repeated ? "failed" : "completed");
  if (repeated) expect(message.error).toContain("重复执行");
  const calls = (await fs.readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(item => item.method === "tools/call");
  expect(calls.map(item => item.params.name)).toEqual(["echo", "write", "echo"]);
});
it("preserves actionable schema errors through the actual agent dispatcher without echoing inputs", async () => {
  let result: ToolResultMessage | undefined;
  const client: ContinuableModelClient = {
    async *stream() { yield { type: "tool_call", tool: "search_materials", input: { query: 42 }, callId: "invalid" }; yield { type: "done" }; },
    async *continue(_prompt, results) { result = results[0]; yield { type: "text_delta", text: "请使用文字检索条件。" }; yield { type: "done" }; },
  };
  const { service, request } = await fixture(client); await service.send(request); await service.idle();
  expect(result?.result).toMatchObject({ ok: false, errorCode: "tool_input_invalid", issues: [{ path: "query", code: "invalid_type" }] });
  expect(JSON.stringify(result?.result)).not.toContain("42");
});
it("projects custom provider timing and usage into the shared session with real turn counts", async () => {
  const timing = { transport: "sse" as const, startupMs: 1, requestMs: 2, selectionMs: 0, totalMs: 3, processTailMs: 0 };
  const usage = { inputTokens: 10, outputTokens: 3, model: "synthetic" }; let auditedTurns = 0;
  const client: ModelClient = { async *stream() { yield { type: "timing", timing }; yield { type: "usage", usage }; yield { type: "text_delta", text: "合成回答。" }; yield { type: "done" }; } };
  const { service, session, request } = await fixture(client);
  await service.invoke(request, { runtime: providerRuntime("mock", client), request: { role: "tutor", providerId: "mock", prompt: "synthetic", containsUserMaterials: false, confirmed: false, onAudit: value => { auditedTurns = value.turns; } } });
  const saved = (await service.load(session.id)).messages.at(-1)!;
  expect(saved.usage).toMatchObject({ inputTokens: 10, outputTokens: 3 }); expect(saved.model).toBe("synthetic");
  expect(saved.modelTimings).toEqual([timing]); expect(saved.timings?.turns).toBe(1); expect(auditedTurns).toBe(1);
});
