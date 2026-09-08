import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LearningApplication } from "../src/learning-application.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { TaskExecutionStore } from "../src/task-execution.js";
import { TaskContinuity } from "../src/task-continuity.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { collectInvocation } from "../src/model-invocation.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-continuity-")); const app = await LearningApplication.open(root, process.cwd());
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const identity = { taskId: randomUUID(), sessionId: randomUUID(), topicId: "rag" }; const journal = new AgentExecutionStore(app.database, identity);
  return { root, app, identity, journal, continuity: new TaskContinuity(app.database) };
}
it("records human recovery reports as unverified observations, without replay or forged success", async () => {
  const { app, identity, journal, continuity } = await fixture(); const release = journal.claim();
  journal.save({ version: 1, status: "failed", prompt: "synthetic", history: [], decisions: {}, containsMaterials: true, pending: { events: [{ type: "tool_call", tool: "mcp_synthetic_write", callId: "write", input: { id: "resource" } }], toolResults: [], next: 0, phase: "executing" } }, "tool_started"); release();
  expect(continuity.inspect(identity).recovery?.callId).toBe("write");
  continuity.report(identity, "write", { outcome: "reported_success", note: "我在服务界面看到了结果。" });
  const saved = new AgentExecutionStore(app.database, identity).read()!;
  expect(saved.pending?.toolResults[0]?.result).toMatchObject({ ok: false, source: "user_report", verified: false, outcome: "reported_success" });
  expect(saved.pending?.next).toBe(1); expect(saved.pending?.phase).toBe("ready");
  expect(() => continuity.report(identity, "write", { outcome: "reported_success", note: "我在服务界面看到了结果。" })).not.toThrow();
  let writes = 0;
  const client = { async *stream() { throw new Error("must resume"); yield { type: "done" as const }; }, async *continue() { yield { type: "text_delta" as const, text: "该操作只有用户报告，尚无服务核验。" }; yield { type: "done" as const }; } };
  await collectInvocation(providerRuntime("mock", client), { execution: journal, role: "tutor", providerId: "mock", prompt: "synthetic", resumeInput: "继续其余说明", containsUserMaterials: true, confirmed: true, materialContext: true, canReplayTool: () => false, onToolCall: async () => { writes++; } }, new AbortController().signal);
  expect(writes).toBe(0);
  expect(() => continuity.inspect({ ...identity, sessionId: randomUUID() })).toThrow("execution_scope_mismatch");
});
it("revises goals only through explicit versioned user action while retaining old plans", async () => {
  const { app, identity } = await fixture(); const tasks = new TaskExecutionStore(app.database);
  tasks.begin(identity.taskId, "rag", "原始目标"); tasks.plan(identity.taskId, "rag", [{ id: "test", title: "测试", doneWhen: "tests_passed" }]);
  expect(() => tasks.plan(identity.taskId, "rag", [{ id: "save", title: "保存", doneWhen: "artifact_saved" }])).toThrow("task_plan_requirement_changed");
  tasks.revise(identity.taskId, "rag", 0, "只需说明方案，取消执行测试");
  expect(tasks.snapshot(identity.taskId, "rag")).toMatchObject({ goal: "只需说明方案，取消执行测试", revision: 1, plan: [] });
  expect(tasks.revisions(identity.taskId, "rag")[0]).toMatchObject({ goal: "原始目标", plan: [{ id: "test" }] });
  expect(() => tasks.revise(identity.taskId, "rag", 0, "旧界面再次修改")).toThrow("task_revision_conflict");
});
it("accumulates usage across bounded continuations and exposes the reason for stopping", async () => {
  const { identity, journal, continuity } = await fixture();
  const client = { async *stream() { yield { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 2 } }; yield { type: "text_delta" as const, text: "合成回答" }; yield { type: "done" as const }; }, async *continue() { yield* this.stream(); } };
  const request = { execution: journal, role: "tutor" as const, providerId: "mock", prompt: "synthetic", containsUserMaterials: false, confirmed: false };
  await collectInvocation(providerRuntime("mock", client), request, new AbortController().signal);
  await collectInvocation(providerRuntime("mock", client), { ...request, resumeInput: "接着讲" }, new AbortController().signal);
  expect(continuity.inspect(identity).usage).toMatchObject({ segments: 2, modelTurns: 2, inputTokens: 20, outputTokens: 4 });
});

it("revises a completed task through the shared service with stable identity and rejects a foreign session", async () => {
  const { root, app } = await fixture();
  const { AgentService } = await import("../src/agent-service.js"); const { AgentSessionStore } = await import("../src/agent-session-store.js");
  const prompts: string[] = [];
  const client = { async *stream(prompt: string) { prompts.push(prompt); yield { type: "text_delta" as const, text: "合成说明" }; yield { type: "done" as const }; }, async *continue(prompt: string, _results: readonly unknown[], _signal: AbortSignal, options?: import("../src/model.js").ModelRequestOptions) { yield* this.stream(prompt + JSON.stringify(options?.history)); } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app);
  cleanup.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); });
  const session = await service.create(); await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", topicId: "rag", contextAllowed: true, text: "解释检索" }); await service.idle();
  const taskId = (await service.load(session.id)).messages.at(-1)!.taskId!;
  const foreign = await service.create(); await expect(service.taskInfo(foreign.id, taskId)).rejects.toThrow("task_not_found");
  await service.reviseTask(session.id, taskId, 0, "改为用缓存解释检索，直接给答案"); await service.idle();
  const revised = await service.taskInfo(session.id, taskId);
  expect(revised.task).toMatchObject({ revision: 1, goal: "改为用缓存解释检索，直接给答案" });
  expect(revised.revisions).toHaveLength(1); expect(revised.usage.segments).toBe(2);
  expect((await service.load(session.id)).messages.at(-1)?.taskId).toBe(taskId);
  expect(prompts.at(-1)).toContain("改为用缓存解释检索");
  await expect(service.reviseTask(session.id, taskId, 0, "过期修改")).rejects.toThrow("task_revision_conflict");
});

it.each(["success", "absent", "mismatch", "unknown", "user_report", "revoked"])("reconciles a disconnected external write by exact service identity (%s)", async mode => {
  const { root, app, continuity } = await fixture();
  const { AgentService } = await import("../src/agent-service.js"); const { AgentSessionStore } = await import("../src/agent-session-store.js");
  const { McpSettings } = await import("../src/mcp-tools.js"); const { verifyMcpRecovery } = await import("../src/mcp-recovery.js");
  const record = path.join(root, "effects.jsonl");
  new McpSettings(app.database).replace("rag", 0, [{ id: "fixture", enabled: true, consent: "local-process-and-topic-inputs", command: process.execPath, args: [path.resolve("tests/fixtures/mcp-recovery-server.mjs"), mode, record], tools: [
    { name: "write", risk: "write", replaySafe: false, reconcile: { tool: "status", argument: "text", identity: "text", resultIdentity: "text", status: "status", succeeded: "succeeded", notExecuted: "not_found" } },
    { name: "status", risk: "read", replaySafe: true },
  ] }]);
  let resumes = 0;
  const client = { async *stream() { yield { type: "tool_call" as const, tool: "discover_tools", input: { category: "external" }, callId: "discover" }; yield { type: "done" as const }; },
    async *continue(_prompt: string, _results: readonly unknown[], _signal: AbortSignal, options?: import("../src/model.js").ModelRequestOptions) { yield { type: "tool_call" as const, tool: options!.tools!.find(tool => tool.name.startsWith("mcp_fixture_write_"))!.name, input: { text: "synthetic operation" }, callId: ++resumes === 1 ? "write" : "write-again" }; yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app); cleanup.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); });
  const session = await service.create(); await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", topicId: "rag", contextAllowed: true, execution: "session", text: "执行合成操作" }); await service.idle();
  const approval = (await service.load(session.id)).messages.at(-1)!.items!.find(item => item.kind === "approval")!;
  await service.answerInteraction(session.id, approval.id, "allow"); await service.idle();
  const message = (await service.load(session.id)).messages.at(-1)!; expect(message.error).toContain("结果不确定");
  const identity = { sessionId: session.id, taskId: message.taskId!, topicId: "rag" };
  if (mode === "user_report") {
    await service.reportRecovery(session.id, message.taskId!, "write", { outcome: "reported_success", note: "合成用户观察" });
    await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", resumeTaskId: message.taskId, execution: "session", text: "继续" }); await service.idle();
    const waiting = (await service.load(session.id)).messages.at(-1)!;
    expect(waiting.status).toBe("waiting"); expect(waiting.items).toContainEqual(expect.objectContaining({ kind: "approval", callId: "write-again", status: "pending" }));
  } else if (mode === "revoked") {
    McpSettings.revokeAll(app.database);
    await expect(service.verifyRecovery(session.id, message.taskId!, "write")).rejects.toThrow("permission_scope_changed");
    expect(continuity.inspect(identity).recovery?.callId).toBe("write");
  } else if (mode === "mismatch" || mode === "unknown") {
    await expect(verifyMcpRecovery(app.database, identity, "write", new AbortController().signal)).rejects.toThrow(mode === "mismatch" ? "recovery_identity_mismatch" : "recovery_still_unknown");
    expect(continuity.inspect(identity).recovery?.callId).toBe("write");
  } else {
    const result = await verifyMcpRecovery(app.database, identity, "write", new AbortController().signal);
    expect(result.recovery).toBeNull(); expect(result.receipts[0]?.result).toMatchObject({ ok: mode === "success", verified: true, source: "external_query", originalResponse: "unavailable" });
  }
  const events = (await fs.readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(events.filter(event => event.call === "write")).toHaveLength(1); expect(events.filter(event => event.call === "status")).toHaveLength(mode === "user_report" || mode === "revoked" ? 0 : 1);
});
