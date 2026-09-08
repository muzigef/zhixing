import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { ToolHarness } from "../src/tool-harness.js";
import { collectInvocation, type InvocationRequest } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { ZhixingDatabase } from "../src/database.js";
import type { ContinuableModelClient } from "../src/model.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function journal() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-parallel-"));
  const db = new ZhixingDatabase(path.join(root, "db.sqlite"));
  cleanup.push(async () => { db.close(); await fs.rm(root, { recursive: true, force: true }); });
  return new AgentExecutionStore(db, { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" });
}
function client(names: string[]): ContinuableModelClient {
  return { async *stream() { for (const [i, tool] of names.entries()) yield { type: "tool_call", tool, input: { i }, callId: `c${i}` }; yield { type: "done" }; },
    async *continue(_prompt, results) { yield { type: "text_delta", text: results.map(r => r.callId).join(",") }; yield { type: "done" }; } };
}
const base = { role: "tutor", providerId: "fixture", prompt: "test", containsUserMaterials: false, confirmed: false, requireDone: true } as const;

it("only explicitly pure read tools qualify; a false write/idempotence declaration is rejected", () => {
  const h = new ToolHarness(); const tool = { name: "r", input: z.object({}), risk: "read" as const, timeoutMs: 100, idempotent: true, execute: async () => 1 };
  h.register(tool); expect(h.isParallelSafe("r")).toBe(false);
  h.register({ ...tool, name: "safe", parallelSafe: true }); expect(h.isParallelSafe("safe")).toBe(true);
  expect(() => h.register({ ...tool, name: "w", risk: "write", parallelSafe: true })).toThrow("tool_parallel_policy_invalid");
  expect(() => h.register({ ...tool, name: "nonrepeatable", idempotent: false, parallelSafe: true })).toThrow("tool_parallel_policy_invalid");
});

it("bounds concurrency at two, preserves model order and serial barriers", async () => {
  const store = await journal(); let active = 0; let peak = 0; const finished: string[] = []; const seen: string[] = [];
  const result = await collectInvocation(providerRuntime("fixture", client(["r", "r", "write", "r", "r", "r"])), {
    ...base, execution: store, canParallelTool: name => name === "r", canReplayTool: name => name === "r",
    onToolCall: async (name, input, _signal, id) => {
      if (name === "write") expect(active).toBe(0);
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, (input as { i: number }).i % 2 ? 1 : 15));
      active--; finished.push(id!); return id;
    }, onToolResult: (_tool, value) => seen.push(String(value)),
  }, new AbortController().signal);
  expect(peak).toBe(2); expect(finished.slice(0, 3)).toEqual(["c1", "c0", "c2"]);
  expect(seen).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
  expect(result.finalText).toBe(seen.join(",")); expect(store.read()?.version).toBe(2);
  expect(store.read()?.status).toBe("completed");
});

it("saves both completed reads before a consumer cancellation, so resume never repeats them", async () => {
  const store = await journal(); const c = new AbortController(); const calls: string[] = [];
  const request: InvocationRequest = { ...base, execution: store, canParallelTool: n => n === "r", canReplayTool: n => n === "r",
    onToolCall: async (_name, _input, _signal, id) => { calls.push(id!); return id; }, onToolResult: () => c.abort() };
  await expect(collectInvocation(providerRuntime("fixture", client(["r", "r", "write"])), request, c.signal)).rejects.toThrow();
  expect(store.read()?.pending?.next).toBe(2);
  await collectInvocation(providerRuntime("fixture", client([])), { ...request, onToolResult: undefined }, new AbortController().signal);
  expect(calls).toEqual(["c0", "c1", "c2"]);
});

it("journals every started read on cancellation; changed replay permissions reject recovery and steering", async () => {
  const store = await journal(); const c = new AbortController(); const calls: string[] = [];
  await expect(collectInvocation(providerRuntime("fixture", client(["r", "r", "write"])), {
    ...base, execution: store, canParallelTool: n => n === "r", canReplayTool: () => true,
    onToolCall: async (_name, _input, signal, id) => { calls.push(id!); if (calls.length === 2) c.abort(); await new Promise<void>((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }); },
  }, c.signal)).rejects.toThrow();
  expect(calls).toEqual(["c0", "c1"]); expect(store.read()?.pending).toMatchObject({ next: 0, phase: "executing", executingUntil: 2 });
  await expect(collectInvocation(providerRuntime("fixture", client([])), { ...base, execution: store, canReplayTool: () => false, onToolCall: async () => 1, steerId: crypto.randomUUID() }, new AbortController().signal)).rejects.toThrow("tool_recovery_required");
  await collectInvocation(providerRuntime("fixture", client([])), { ...base, execution: store, canReplayTool: () => true, onToolCall: async () => { throw new Error("superseded"); }, steerId: crypto.randomUUID(), resumeInput: "new request" }, new AbortController().signal);
  expect(store.read()?.history[0]?.toolResults.map(r => r.dispatch)).toEqual(["unknown", "unknown", "not_started"]);
});

it("rejects oversized pending input before either parallel dispatch", async () => {
  let calls = 0;
  await expect(collectInvocation(providerRuntime("fixture", client(["r", "r"])), { ...base, limits: { maxContextChars: 10 }, canParallelTool: () => true, onToolCall: async () => ++calls }, new AbortController().signal)).rejects.toThrow("model_input_limit");
  expect(calls).toBe(0);
});

it("keeps the one-repair answer budget across interrupted execution recovery", async () => {
  const store = await journal(); const c = new AbortController(); let requests = 0;
  const bad: ContinuableModelClient = { async *stream() { requests++; yield { type: "text_delta", text: "continue" }; yield { type: "done" }; }, async *continue() { requests++; yield { type: "text_delta", text: "continue" }; yield { type: "done" }; } };
  const request: InvocationRequest = { ...base, execution: store, responseCheck: () => "实际续写", onTurn: (_text, kind) => { if (kind === "progress") c.abort(); } };
  await expect(collectInvocation(providerRuntime("fixture", bad), request, c.signal)).rejects.toThrow();
  expect(store.read()?.history).toHaveLength(1);
  const result = await collectInvocation(providerRuntime("fixture", bad), { ...request, onTurn: undefined }, new AbortController().signal);
  expect(result).toMatchObject({ blocked: true, stopReason: "response_contract_failed" });
  expect(requests).toBe(2); expect(store.read()?.status).toBe("blocked");
});
