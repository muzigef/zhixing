import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { AgentExecutionStore, type ExecutionCheckpoint } from "../src/agent-execution-store.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import type { ContinuableModelClient } from "../src/model.js";

const roots: string[] = []; const databases: ZhixingDatabase[] = [];
afterEach(async () => { databases.splice(0).forEach(db => db.close()); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(pending?: ExecutionCheckpoint["pending"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-recovery-boundary-")); roots.push(root);
  const db = new ZhixingDatabase(path.join(root, "db.sqlite")); databases.push(db);
  const store = new AgentExecutionStore(db, { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" });
  if (pending) {
    const release = store.claim();
    store.save({ version: 1, status: "interrupted", prompt: "合成任务", containsMaterials: false, history: [], decisions: {}, pending }, "fixture"); release();
  }
  return store;
}
const base = { role: "tutor" as const, providerId: "fixture", prompt: "合成任务", containsUserMaterials: false, confirmed: false, requireDone: true };
const signal = () => new AbortController().signal;
const read = (callId: string, value = callId) => ({ type: "tool_call" as const, tool: "read", input: { value }, callId });
const finalClient: ContinuableModelClient = {
  async *stream() { throw new Error("must continue saved turn"); yield { type: "done" }; },
  async *continue() { yield { type: "text_delta", text: "已完成" }; yield { type: "done" }; },
};

it.each(["ready", "executing"] as const)("restores loop protection from the actual dispatch state (%s) after steering and another restart", async phase => {
  const store = await fixture({ events: [read("old", "same")], toolResults: [], next: 0, phase });
  const offline: ContinuableModelClient = { ...finalClient, async *continue() { throw new Error("synthetic provider offline"); yield { type: "done" }; } };
  await expect(collectInvocation(providerRuntime("fixture", offline), { ...base, execution: store, steerId: crypto.randomUUID(), resumeInput: "先调整顺序", canReplayTool: () => true, onToolCall: async () => { throw new Error("old call must not run"); } }, signal())).rejects.toThrow("synthetic provider offline");
  expect(store.read()?.history[0]?.toolResults[0]?.dispatch).toBe(phase === "ready" ? "not_started" : "unknown");
  let rounds = 0; let calls = 0;
  const resumed: ContinuableModelClient = { ...finalClient, async *continue() {
    if (++rounds === 1) yield read("new", "same"); else yield { type: "text_delta", text: "已执行一次" }; yield { type: "done" };
  } };
  const pending = collectInvocation(providerRuntime("fixture", resumed), { ...base, execution: store, onToolCall: async () => { calls++; return { ok: true }; } }, signal());
  if (phase === "executing") { await expect(pending).rejects.toThrow("repeated_tool_call"); expect(calls).toBe(0); return; }
  const output = await pending;
  expect(calls).toBe(1); expect(output.finalText).toBe("已执行一次");
});

it("still bounds a genuinely dispatched call even if its payload resembles cancellation metadata", async () => {
  const store = await fixture();
  const first: ContinuableModelClient = { async *stream() { yield read("old", "same"); yield { type: "done" }; }, async *continue() { throw new Error("synthetic provider offline"); yield { type: "done" }; } };
  await expect(collectInvocation(providerRuntime("fixture", first), { ...base, execution: store, onToolCall: async () => ({ ok: false, errorCode: "tool_superseded", outcome: "not_started" }) }, signal())).rejects.toThrow("synthetic provider offline");
  const resumed: ContinuableModelClient = { ...finalClient, async *continue() { yield read("new", "same"); yield { type: "done" }; } };
  let calls = 0;
  await expect(collectInvocation(providerRuntime("fixture", resumed), { ...base, execution: store, onToolCall: async () => { calls++; } }, signal())).rejects.toThrow("repeated_tool_call");
  expect(calls).toBe(0);
});

it.each(["call count", "input size"])("checks restored pending %s before dispatching any effects", async kind => {
  const store = await fixture({ events: [read("one"), read("two", kind === "input size" ? "x".repeat(2000) : "two")], toolResults: [], next: 0, phase: "ready" });
  const before = store.read()?.pending; let calls = 0;
  await expect(collectInvocation(providerRuntime("fixture", finalClient), { ...base, execution: store,
    limits: kind === "call count" ? { maxToolCalls: 1 } : { maxContextChars: 1000 }, onToolCall: async () => { calls++; return { ok: true }; },
  }, signal())).rejects.toThrow(kind === "call count" ? "max_tool_calls" : "model_input_limit");
  expect(calls).toBe(0); expect(store.read()?.pending).toEqual(before);
  expect(store.events().some(event => event.type === "tool_started")).toBe(false);
});

it("counts restored remaining calls against the same budget as newly requested calls", async () => {
  const store = await fixture({ events: [read("done"), read("remaining")], toolResults: [{ tool: "read", callId: "done", result: { ok: true } }], next: 1, phase: "ready" });
  const client: ContinuableModelClient = { ...finalClient, async *continue() { yield read("extra"); yield { type: "done" }; } };
  const calls: string[] = [];
  await expect(collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, limits: { maxToolCalls: 1 }, onToolCall: async (_tool, _input, _signal, id) => { calls.push(id!); return { ok: true }; } }, signal())).rejects.toThrow("max_tool_calls");
  expect(calls).toEqual(["remaining"]);
});

it("preserves a real result but stops before the next effect when it exhausts context space", async () => {
  const store = await fixture({ events: [read("one"), read("two")], toolResults: [], next: 0, phase: "ready" });
  const calls: string[] = [];
  await expect(collectInvocation(providerRuntime("fixture", finalClient), { ...base, execution: store, limits: { maxContextChars: 1000 }, onToolCall: async (_tool, _input, _signal, id) => { calls.push(id!); return "x".repeat(2000); } }, signal())).rejects.toThrow("model_input_limit");
  expect(calls).toEqual(["one"]); expect(store.read()?.pending?.next).toBe(1); expect(store.read()?.pending?.toolResults).toHaveLength(1);
});

it.each(["cancel", "timeout"])("bounds asynchronous completion verification on %s", async mode => {
  const store = await fixture(); const controller = new AbortController();
  let release!: () => void; const gate = new Promise<undefined>(resolve => { release = () => resolve(undefined); });
  let ready!: () => void; const checking = new Promise<void>(resolve => { ready = resolve; });
  let calls = 0; let settled = false;
  const client = { async *stream() { calls++; yield { type: "text_delta" as const, text: "完成" }; yield { type: "done" as const }; } };
  const result = collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, limits: { timeoutMs: mode === "timeout" ? 30 : 1000 }, completionCheck: () => { ready(); return gate; } }, controller.signal)
    .then(value => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });
  await checking; if (mode === "cancel") controller.abort();
  await new Promise(resolve => setTimeout(resolve, 80));
  const bounded = settled;
  release(); const output = await result;
  expect(bounded).toBe(true); expect(output).toBeInstanceOf(Error);
  expect((output as Error).message).toBe(mode === "cancel" ? "cancelled" : "invocation_timeout");
  expect(calls).toBe(0); expect(store.read()?.status).toBe(mode === "cancel" ? "interrupted" : "failed");
});

it("never journals completion if cancellation occurs during the final verification", async () => {
  const store = await fixture(); const controller = new AbortController(); let checks = 0;
  const client = { async *stream() { yield { type: "text_delta" as const, text: "完成" }; yield { type: "done" as const }; } };
  await expect(collectInvocation(providerRuntime("fixture", client), { ...base, execution: store, completionCheck: async () => { if (++checks === 2) controller.abort(); return undefined; } }, controller.signal)).rejects.toThrow("cancelled");
  expect(store.events().some(event => event.type === "completed")).toBe(false); expect(store.read()?.status).toBe("interrupted");
});
