import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { McpConnection, McpSettings, attachMcpTools, mcpAlias } from "../src/mcp-tools.js";
import { JsonSchemaWorker } from "../src/json-schema-worker.js";
import { ToolHarness, ToolOutcomeUnknown } from "../src/tool-harness.js";
import { z } from "zod/v4";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(mode = "modern") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-mcp-")); const app = await LearningApplication.open(path.join(root, "workspace"));
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const record = path.join(root, "calls.jsonl");
  const config = { id: "fixture", enabled: true, consent: "local-process-and-topic-inputs" as const, command: process.execPath, args: [path.resolve("tests/fixtures/mcp-server.mjs"), mode, record], tools: [{ name: "echo", risk: "read" as const, replaySafe: true }, { name: "write", risk: "write" as const, replaySafe: false }, { name: "slow", risk: "read" as const, replaySafe: true }] };
  return { root, app, config, record };
}
it.each(["modern", "legacy", "silent"])("negotiates %s stdio with actual child processes, validates input and excludes inherited secrets", async mode => {
  const { app, config, record } = await fixture(mode); const settings = new McpSettings(app.database); settings.replace("rag", 0, [config]);
  process.env.ZHIXING_MCP_PRIVATE_FIXTURE = "synthetic-private";
  const attached = await attachMcpTools(app.tools(true), settings, "rag", new AbortController().signal);
  delete process.env.ZHIXING_MCP_PRIVATE_FIXTURE;
  cleanup.push(async () => { await attached.close(); });
  const name = mcpAlias(config, "echo", { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 200 } }, required: ["text"], additionalProperties: false }); const context = { topicId: "rag", signal: new AbortController().signal };
  expect(attached.tools.harness.isReplaySafe(name)).toBe(true); expect(attached.tools.harness.isParallelSafe(name)).toBe(false);
  const result = await attached.tools.harness.execute(name, { text: "合成回声" }, context);
  expect(result).toMatchObject({ ok: true, output: { structuredContent: { text: "合成回声", inheritedPrivate: false, inheritedNodeOptions: false } } });
  const bad = await attached.tools.harness.execute(name, { text: 42 }, context); expect(bad.ok).toBe(false);
  const log = (await fs.readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(log.filter(r => r.method === "tools/call")).toHaveLength(1);
  expect(log[0].method).toBe("server/discover");
  expect(log.some(r => r.method === "initialize")).toBe(mode !== "modern");
  expect((await attached.tools.harness.execute(name, { text: "x" }, { ...context, topicId: "tool-calling" })).ok).toBe(false);
});

it("rejects modern protocol errors without legacy downgrade, malformed frames and cancelled children", async () => {
  for (const mode of ["unsupported", "malformed"]) {
    const { config, record } = await fixture(mode);
    await expect(McpConnection.open(config, new AbortController().signal)).rejects.toThrow(/mcp_/);
    const log = await fs.readFile(record, "utf8").catch(() => ""); expect(log).not.toContain('"method":"initialize"');
  }
  const { config, record } = await fixture(); const controller = new AbortController(); const connection = await McpConnection.open(config, controller.signal);
  const pending = connection.call("slow", {}, controller.signal);
  // Cancel only after the fixture has received the actual request.
  for (let i = 0; i < 100 && !(await fs.readFile(record, "utf8")).includes('"method":"tools/call"'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(); await expect(pending).rejects.toThrow(); await connection.close();
  expect(await fs.readFile(record, "utf8")).toContain("notifications/cancelled");
  expect(connection.closed).toBe(true);
});

it("requires topic consent, supports revision conflicts, revocation and disabled recovery", async () => {
  const { app, config } = await fixture(); const settings = new McpSettings(app.database);
  expect(() => settings.replace("rag", 0, [{ ...config, consent: undefined }])).toThrow();
  settings.replace("rag", 0, [config]); expect(settings.read("tool-calling").servers).toEqual([]);
  expect(() => settings.replace("rag", 0, [])).toThrow("mcp_settings_conflict");
  const attached = await attachMcpTools(app.tools(true), settings, "rag", new AbortController().signal); cleanup.push(async () => { await attached.close(); });
  settings.replace("rag", 1, [{ ...config, enabled: false }]);
  expect((await attached.tools.harness.execute(mcpAlias(config, "echo", { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 200 } }, required: ["text"], additionalProperties: false }), { text: "revoked" }, { topicId: "rag", signal: new AbortController().signal })).ok).toBe(false);
  expect((await attachMcpTools(app.tools(true), settings, "rag", new AbortController().signal)).tools.definitions.some(t => t.name.startsWith("mcp_"))).toBe(false);
  settings.replace("rag", 2, [config]); McpSettings.revokeAll(app.database);
  expect(settings.read("rag").servers.every(s => !s.enabled)).toBe(true);
});

it("uses the real agent discovery/approval/restart loop; server annotations cannot authorize writes", async () => {
  const { root, app, config, record } = await fixture(); new McpSettings(app.database).replace("rag", 0, [config]);
  const tool = mcpAlias(config, "write", { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }); let turns = 0;
  const client = { async *stream() { turns++; yield { type: "tool_call" as const, tool: "discover_tools", input: { category: "external" }, callId: "discover" }; yield { type: "done" as const }; },
    async *continue(_prompt: string, results: readonly { tool: string; result: unknown }[]) { if (results[0]?.tool === "discover_tools") yield { type: "tool_call" as const, tool, input: { text: "approved synthetic" }, callId: "write" }; else yield { type: "text_delta" as const, text: "实际工具已返回。" }; yield { type: "done" as const }; } };
  const store = new AgentSessionStore(path.join(root, "sessions")); const first = new AgentService(store, () => client, app); const session = await first.create();
  await first.send({ sessionId: session.id, text: "调用已配置工具", topicId: "rag", contextAllowed: true, provider: "mock", style: "adaptive" }); await first.idle();
  const waiting = (await first.load(session.id)).messages.at(-1)!; expect(waiting.status).toBe("waiting");
  expect(await fs.readFile(record, "utf8")).not.toContain('"method":"tools/call"');
  const card = waiting.items!.find(item => item.kind === "approval")!; expect(card).toMatchObject({ tool, input: { text: "approved synthetic" } });
  const resumed = new AgentService(store, () => client, app); await resumed.answerInteraction(session.id, card.id, "allow", "once"); await resumed.idle();
  expect((await resumed.load(session.id)).messages.at(-1)?.status).toBe("completed"); expect(turns).toBe(1);
  expect((await fs.readFile(record, "utf8")).split("\n").filter(line => line.includes('"method":"tools/call"'))).toHaveLength(1);
});

it("validates complex schemas in an isolated worker and refuses remote references and unverified formats", async () => {
  const worker = new JsonSchemaWorker(); cleanup.push(async () => { await worker.close(); }); const signal = new AbortController().signal;
  await worker.check("tuple", { schema: { type: "object", properties: { point: { type: "array", prefixItems: [{ type: "number" }, { type: "number" }], items: false, minItems: 2 } }, required: ["point"], additionalProperties: false } }, signal);
  await worker.check("tuple", { input: { point: [1, 2] } }, signal);
  await expect(worker.check("tuple", { input: { point: [1, "wrong"] } }, signal)).rejects.toThrow("mcp_input_invalid");
  await expect(worker.check("remote", { schema: { $ref: "https://example.invalid/schema" } }, signal)).rejects.toThrow("mcp_schema_unsupported");
  await expect(worker.check("format", { schema: { type: "string", format: "unsupported-private-format" } }, signal)).rejects.toThrow("mcp_schema_unsupported");
});

it("does not turn a disconnected external write into a normal failed result or replayable operation", async () => {
  const { app, config } = await fixture("disconnect-write"); const settings = new McpSettings(app.database); settings.replace("rag", 0, [config]);
  const attached = await attachMcpTools(app.tools(true), settings, "rag", new AbortController().signal); cleanup.push(async () => { await attached.close(); });
  const name = attached.tools.definitions.find(tool => tool.name.startsWith("mcp_fixture_write_"))!.name;
  expect(attached.tools.harness.isReplaySafe(name)).toBe(false);
  await expect(attached.tools.harness.execute(name, { text: "synthetic effect" }, { topicId: "rag", signal: new AbortController().signal, maxRisk: "write" })).rejects.toBeInstanceOf(ToolOutcomeUnknown);
});

it("preserves unknown external write outcomes even when the harness deadline wins the cancellation race", async () => {
  const harness = new ToolHarness();
  harness.register({ name: "external", risk: "write", input: z.object({}), timeoutMs: 10, idempotent: false, execute: async () => new Promise(() => {}) });
  await expect(harness.execute("external", {}, { topicId: "rag", maxRisk: "write", signal: new AbortController().signal })).rejects.toBeInstanceOf(ToolOutcomeUnknown);
});

it("keeps ordinary learning queries available when one configured server is offline", async () => {
  const { app, config } = await fixture("unsupported"); const settings = new McpSettings(app.database); settings.replace("rag", 0, [config]);
  const attached = await attachMcpTools(app.tools(true), settings, "rag", new AbortController().signal); cleanup.push(async () => { await attached.close(); });
  expect(attached.tools.definitions.some(tool => tool.name === "learning_progress")).toBe(true);
  const status = attached.tools.definitions.find(tool => tool.name.startsWith("mcp_"))!;
  expect(await attached.tools.harness.execute(status.name, {}, { topicId: "rag", signal: new AbortController().signal })).toMatchObject({ ok: true, output: { available: false } });
});
