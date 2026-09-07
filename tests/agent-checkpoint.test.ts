import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import type { ContinuableModelClient } from "../src/model.js";

const roots: string[] = []; const databases: ZhixingDatabase[] = [];
afterEach(async () => { databases.splice(0).forEach(db => db.close()); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-checkpoint-")); roots.push(root);
  const db = new ZhixingDatabase(path.join(root, "db.sqlite")); databases.push(db);
  const identity = { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" };
  return { db, identity, store: new AgentExecutionStore(db, identity) };
}
const base = { role: "tutor" as const, providerId: "fixture", prompt: "完成任务", containsUserMaterials: false, confirmed: false, requireDone: true };

it("persists a validated multi-tool turn before approval and resumes native calls without private provider state", async () => {
  const { db, identity, store } = await fixture(); let waiting = false;
  const first: ContinuableModelClient = {
    async *stream() {
      yield { type: "tool_call", tool: "save", input: { value: 1 }, callId: "first" };
      yield { type: "tool_call", tool: "save", input: { value: 2 }, callId: "second" };
      yield { type: "provider_state", result: { privateThinking: "opaque-state-fixture" } };
      yield { type: "done" };
    },
    async *continue() { throw new Error("unexpected continuation before answer"); yield { type: "done" }; },
  };
  const paused = await collectInvocation(providerRuntime("fixture", first), { ...base, execution: store, shouldPause: () => waiting, onToolCall: async () => { waiting = true; return { pending: true }; } }, new AbortController().signal);
  expect(paused.waiting).toBe(true);
  expect(store.read()?.pending?.events.filter(event => event.type === "tool_call")).toHaveLength(2);
  expect(JSON.stringify(store.read())).not.toContain("opaque-state-fixture");
  let starts = 0; const executed: unknown[] = [];
  const resumed: ContinuableModelClient = {
    async *stream() { starts++; throw new Error("must continue saved tool turn"); yield { type: "done" }; },
    async *continue(_prompt, results, _signal, options) {
      expect(results.map(result => result.callId)).toEqual(["first", "second"]);
      expect(options?.history?.[0]?.toolResults.map(result => result.result)).toEqual([{ saved: 1 }, { saved: 2 }]);
      yield { type: "text_delta", text: "完成。" }; yield { type: "done" };
    },
  };
  const restored = new AgentExecutionStore(db, identity);
  const result = await collectInvocation(providerRuntime("fixture", resumed), { ...base, execution: restored, onToolCall: async (_tool, input) => { executed.push(input); return { saved: (input as { value: number }).value }; } }, new AbortController().signal);
  expect(starts).toBe(0); expect(executed).toEqual([{ value: 1 }, { value: 2 }]); expect(result.finalText).toBe("完成。");
  expect(restored.read()?.status).toBe("completed");
  const events = restored.events(); expect(events.map(event => event.sequence)).toEqual(events.map((_event, index) => index + 1));
});

it("keeps completed tool results when cancellation interrupts the next dispatch", async () => {
  const { store } = await fixture(); const controller = new AbortController(); let count = 0;
  const client: ContinuableModelClient = {
    async *stream() { for (const value of [1, 2]) yield { type: "tool_call", tool: "read", input: { value }, callId: `c${value}` }; yield { type: "done" }; },
    async *continue() { yield { type: "text_delta", text: "ok" }; yield { type: "done" }; },
  };
  await expect(collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, onToolCall: async () => { count++; return "real"; }, onToolResult: () => controller.abort() }, controller.signal)).rejects.toThrow("cancelled");
  expect(store.read()?.pending?.toolResults).toHaveLength(1);
  await collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, onToolCall: async () => { count++; return "real"; } }, new AbortController().signal);
  expect(count).toBe(2);
});

it("rejects other session owners and simultaneous execution leases", async () => {
  const { db, identity, store } = await fixture(); const release = store.claim();
  try {
    expect(() => new AgentExecutionStore(db, identity).claim()).toThrow("execution_in_use");
    expect(() => new AgentExecutionStore(db, { ...identity, sessionId: crypto.randomUUID() }).read()).toThrow("execution_scope_mismatch");
    expect(() => new AgentExecutionStore(db, { ...identity, topicId: "agent-development" }).read()).toThrow("execution_scope_mismatch");
  } finally { release(); }
  const releaseAgain = new AgentExecutionStore(db, identity).claim(); releaseAgain();
});

it("does not overwrite a checkpoint when resumed without its original material consent", async () => {
  const { store } = await fixture(); const release = store.claim();
  store.save({ version: 1, status: "interrupted", prompt: "material fixture", containsMaterials: true, history: [], decisions: {} }, "fixture"); release();
  const before = store.read();
  const client = { async *stream() { throw new Error("must not request model"); yield { type: "done" as const }; } };
  await expect(collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, materialContext: false }, new AbortController().signal)).rejects.toThrow("execution_context_required");
  expect(store.read()).toEqual(before);
});

it.each(["resume", "steer"])("refuses an ambiguous non-idempotent tool after a crash during %s", async mode => {
  const { store } = await fixture(); const release = store.claim();
  store.save({ version: 1, status: "interrupted", prompt: "fixture", containsMaterials: false, history: [], decisions: {}, pending: { events: [{ type: "tool_call", tool: "external_write", input: {}, callId: "call" }], toolResults: [], next: 0, phase: "executing" } }, "fixture"); release();
  let calls = 0;
  const client = { async *stream() { throw new Error("must not request model"); yield { type: "done" as const }; } };
  await expect(collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, ...(mode === "steer" ? { steerId: crypto.randomUUID(), resumeInput: "调整任务" } : {}), onToolCall: async () => { calls++; } }, new AbortController().signal)).rejects.toThrow("tool_recovery_required");
  expect(calls).toBe(0);
});

it("rejects malformed dispatch cursors and future checkpoint versions without mutating them", async () => {
  const { db, identity, store } = await fixture(); const release = store.claim();
  const data = { version: 1, status: "interrupted", prompt: "fixture", containsMaterials: false, history: [], decisions: {}, pending: { events: [{ type: "tool_call", tool: "save", callId: "call", input: {} }], toolResults: [], next: 1, phase: "ready" } };
  db.db.prepare("UPDATE agent_executions SET checkpoint=? WHERE task_id=?").run(JSON.stringify(data), identity.taskId);
  expect(() => store.read()).toThrow("execution_checkpoint_invalid");
  db.db.prepare("UPDATE agent_executions SET checkpoint=? WHERE task_id=?").run(JSON.stringify({ ...data, version: 99 }), identity.taskId);
  expect(() => store.read()).toThrow("storage_version_unsupported"); release();
});

it("retries the same approval decision after a projection write failure without granting a different answer", async () => {
  const { store } = await fixture(); const release = store.claim();
  store.save({ version: 1, status: "waiting", prompt: "fixture", containsMaterials: false, history: [], decisions: {}, pending: { events: [{ type: "tool_call", tool: "save", input: {}, callId: "call" }], toolResults: [], next: 0, phase: "waiting" } }, "fixture"); release();
  store.decide("call", "deny", "once");
  expect(() => store.decide("call", "deny", "once")).not.toThrow();
  expect(() => store.decide("call", "allow", "once")).toThrow("interaction_resolved");
});

it("gives an explicit retry a fresh bounded loop after a previous tool failure", async () => {
  const { store } = await fixture();
  const first: ContinuableModelClient = { async *stream() { yield { type: "tool_call", tool: "read", input: {}, callId: "before" }; yield { type: "done" }; }, async *continue() { throw new Error("provider_unavailable"); yield { type: "done" }; } };
  await expect(collectInvocation(providerRuntime("fixture", first), { ...base, execution: store, onToolCall: async () => ({ ok: false }) }, new AbortController().signal)).rejects.toThrow("provider_unavailable");
  let round = 0; let calls = 0;
  const resumed: ContinuableModelClient = { async *stream() { throw new Error("must continue"); yield { type: "done" }; }, async *continue() { if (++round === 1) yield { type: "tool_call", tool: "read", input: {}, callId: "after" }; else yield { type: "text_delta", text: "已重新查询。" }; yield { type: "done" }; } };
  const result = await collectInvocation(providerRuntime("fixture", resumed), { ...base, execution: store, resumeInput: "重试", onToolCall: async () => { calls++; return { ok: true }; } }, new AbortController().signal);
  expect(calls).toBe(1); expect(result.finalText).toBe("已重新查询。");
});

it("does not reapply an acknowledged steering request to newer pending work after restart", async () => {
  const { store } = await fixture(); const steerId = crypto.randomUUID(); const release = store.claim();
  store.save({ version: 1, status: "interrupted", prompt: "新要求", containsMaterials: false, history: [], decisions: {}, steerId,
    pending: { events: [{ type: "tool_call", tool: "read", input: {}, callId: "new-work" }], toolResults: [], next: 0, phase: "ready" },
  }, "fixture"); release();
  let calls = 0;
  const client: ContinuableModelClient = { async *stream() { throw new Error("must continue"); yield { type: "done" }; }, async *continue(_prompt, results) { expect(results[0]?.result).toEqual({ ok: true }); yield { type: "text_delta", text: "继续完成新要求" }; yield { type: "done" }; } };
  await collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, steerId, resumeInput: "继续", onToolCall: async () => { calls++; return { ok: true }; } }, new AbortController().signal);
  expect(calls).toBe(1); expect(store.read()?.steerId).toBe(steerId);
});
