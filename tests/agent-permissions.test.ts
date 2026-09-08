import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { McpSettings } from "../src/mcp-settings.js";
import { writePermission } from "../src/agent-permissions.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import type { ModelRequestOptions } from "../src/model.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-permissions-")); const app = await LearningApplication.open(root, process.cwd());
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await app.projects.create("rag", "合成授权项目", new AbortController().signal); app.projects.select("rag", project.id);
  new McpSettings(app.database).replace("rag", 0, [{ id: "fixture", enabled: true, command: process.execPath, args: [path.resolve("tests/fixtures/mcp-server.mjs")], consent: "local-process-and-topic-inputs", tools: [{ name: "echo", risk: "read", replaySafe: true }] }]);
  const seen: ModelRequestOptions[] = [];
  const client = { async *stream(_prompt: string, _signal: AbortSignal, options?: ModelRequestOptions) { seen.push(options!); yield { type: "text_delta" as const, text: "合成解释" }; yield { type: "done" as const }; }, async *continue() { yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app); cleanup.push(async () => { await service.pauseMaintenance(); });
  return { root, app, project, service, seen };
}
it.each(["materials", "project", "external"] as const)("grants %s access independently from the other two scopes", async kind => {
  const { service, seen } = await fixture(); const session = await service.create();
  await service.send({ sessionId: session.id, text: "解释", provider: "mock", style: "adaptive", topicId: "rag", access: { materials: kind === "materials", project: kind === "project", external: kind === "external" } }); await service.idle();
  const definitions = seen[0]!.tools!;
  expect(definitions.some(tool => tool.name === "search_materials")).toBe(kind === "materials");
  const categories = definitions.find(tool => tool.name === "discover_tools")?.inputSchema as { properties?: { category?: { enum?: string[] } } };
  expect(categories?.properties?.category?.enum?.includes("project") ?? false).toBe(kind === "project");
  expect(categories?.properties?.category?.enum?.includes("external") ?? false).toBe(kind === "external");
  expect((await service.load(session.id)).contextAllowed).toBe(kind === "materials");
});
it("does not widen remembered write grants to another file, tool, topic, or external arguments", () => {
  const input = { projectId: crypto.randomUUID(), path: "src/one.mjs", content: "one", expectedHash: "a".repeat(64) };
  const first = writePermission("project_edit", input, "rag");
  expect(writePermission("project_edit", { ...input, content: "two", expectedHash: "b".repeat(64) }, "rag").key).toBe(first.key);
  expect(writePermission("project_edit", { ...input, path: "src/two.mjs" }, "rag").key).not.toBe(first.key);
  expect(writePermission("project_test", input, "rag").key).not.toBe(first.key);
  expect(writePermission("project_edit", input, "tool-calling").key).not.toBe(first.key);
  expect(writePermission("mcp_fixture_write_v1", { destination: "a" }, "rag").key).not.toBe(writePermission("mcp_fixture_write_v1", { destination: "b" }, "rag").key);
  const batch = { projectId: input.projectId, files: [{ path: input.path, content: "one" }] };
  expect(writePermission("project_edit_many", batch, "rag").key).not.toBe(writePermission("project_edit_many", { ...batch, files: [{ path: input.path, content: null }] }, "rag").key);
});
it("revocation survives a crash after approval and requires fresh approval when access is restored", async () => {
  const { root, app, project } = await fixture();
  const input = { projectId: project.id, path: "src/implementation.mjs", expectedHash: (await app.projects.read("rag", project.id, "src/implementation.mjs")).hash, content: "export const solve = value => value + 1;\n" };
  const client = { async *stream() { yield { type: "tool_call" as const, tool: "project_edit", input, callId: "approved-before-crash" }; yield { type: "done" as const }; }, async *continue() { yield { type: "text_delta" as const, text: "已完成。" }; yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "revocation-sessions")), () => client, app); cleanup.push(async () => service.pauseMaintenance());
  const session = await service.create(); const access = { materials: false, project: true, external: false };
  await service.send({ sessionId: session.id, text: "修改", provider: "mock", style: "adaptive", topicId: "rag", access }); await service.idle();
  const saved = await service.load(session.id); const taskId = saved.messages.at(-1)!.taskId!;
  const execution = new AgentExecutionStore(app.database, { taskId, sessionId: session.id, topicId: "rag" });
  execution.decide("approved-before-crash", "allow", "once"); // Durable decision committed; process ended before execution.
  await service.updatePermissions(session.id, { ...access, project: false });
  await service.updatePermissions(session.id, access);
  expect(execution.read()!.decisions["approved-before-crash"]).toBeUndefined();
  await service.send({ sessionId: session.id, text: "继续", provider: "mock", style: "adaptive", resumeTaskId: taskId }); await service.idle();
  expect((await service.load(session.id)).messages.at(-1)?.status).toBe("waiting");
  expect((await app.projects.read("rag", project.id, input.path)).hash).toBe(input.expectedHash);
});
it("rejects permission changes for a session bound to another workspace", async () => {
  const { root, service } = await fixture(); const session = await service.create();
  session.topicId = "rag"; session.workspaceId = "f".repeat(64);
  await new AgentSessionStore(path.join(root, "sessions")).save(session);
  await expect(service.updatePermissions(session.id, { materials: true, project: false, external: false })).rejects.toThrow("workspace_mismatch");
});
it("revokes scoped permissions and does not silently transfer them to a newly selected project or MCP revision", async () => {
  const { app, project, service } = await fixture(); const session = await service.create();
  const request = { sessionId: session.id, text: "解释", provider: "mock" as const, style: "adaptive" as const, topicId: "rag", access: { materials: false, project: true, external: true } };
  await service.send(request); await service.idle();
  const saved = await service.load(session.id); expect(saved.permissions?.projectId).toBe(project.id);
  const another = await app.projects.create("rag", "另一合成项目", new AbortController().signal); app.projects.select("rag", another.id);
  await expect(service.send(request)).rejects.toThrow("permission_scope_changed");
  await service.updatePermissions(session.id, { materials: false, project: false, external: false });
  expect((await service.load(session.id)).permissions).toMatchObject({ materials: false });
  expect((await service.load(session.id)).permissions?.projectId).toBeUndefined();
  await service.updatePermissions(session.id, request.access);
  const settings = new McpSettings(app.database); const config = settings.read("rag"); settings.replace("rag", config.revision, config.servers);
  await expect(service.send(request)).rejects.toThrow("permission_scope_changed");
});
it("remembers one approved file across turns but still asks for another file and supports revocation", async () => {
  const { root, app, project } = await fixture();
  const store = new AgentSessionStore(path.join(root, "scoped-sessions"));
  let input = { projectId: project.id, path: "src/implementation.mjs", expectedHash: (await app.projects.read("rag", project.id, "src/implementation.mjs")).hash, content: "export const solve = value => value + 1;\n" };
  const client = { async *stream() { yield { type: "tool_call" as const, tool: "project_edit", input, callId: crypto.randomUUID() }; yield { type: "done" as const }; }, async *continue() { yield { type: "text_delta" as const, text: "已处理该项操作。" }; yield { type: "done" as const }; } };
  const service = new AgentService(store, () => client, app); cleanup.push(async () => { await service.pauseMaintenance(); });
  const session = await service.create(); const request = { sessionId: session.id, text: "修改当前文件", provider: "mock" as const, style: "adaptive" as const, topicId: "rag", access: { materials: true, project: true, external: false }, execution: "session" as const };
  await service.send(request); await service.idle();
  let saved = await service.load(session.id);
  expect(saved.messages.at(-1)?.status).toBe("waiting"); // Learning write permission cannot authorize project edits.
  const card = saved.messages.at(-1)!.items!.find(item => item.kind === "approval")!;
  await service.answerInteraction(session.id, card.id, "allow", "session"); await service.idle();
  expect((await app.projects.read("rag", project.id, input.path)).content).toBe(input.content);
  input = { ...input, content: "export const solve = value => value + 2;\n", expectedHash: (await app.projects.read("rag", project.id, input.path)).hash };
  await service.send(request); await service.idle();
  expect((await service.load(session.id)).messages.at(-1)?.status).toBe("completed");
  expect((await app.projects.read("rag", project.id, input.path)).content).toBe(input.content);
  input = { ...input, path: "src/another.mjs", expectedHash: null as unknown as string };
  await service.send(request); await service.idle();
  saved = await service.load(session.id); expect(saved.messages.at(-1)?.status).toBe("waiting");
  await service.updatePermissions(session.id, { materials: true, project: false, external: false });
  saved = await service.load(session.id); expect(saved.writeGrants).toEqual([]);
  const pending = saved.messages.at(-1)!.items!.find(item => item.kind === "approval")!;
  await expect(service.answerInteraction(session.id, pending.id, "allow")).rejects.toThrow("execution_context_required");
  expect((await service.fork(session.id)).permissions).toEqual({ version: 1, materials: false });
});
