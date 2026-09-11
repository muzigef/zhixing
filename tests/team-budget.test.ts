import { describe, expect, it } from "vitest";
import { TeamBudget } from "../src/team-budget.js";
import { teamConfigurationSchema, type TeamSnapshot } from "../src/team-contracts.js";
import type { ModelClient, ModelEvent } from "../src/model.js";
import { randomUUID } from "node:crypto";
import type { AgentExecutor } from "../src/agent-executor.js";
import { adapterCapabilities } from "../src/model-capabilities.js";
import { bindAgentModel } from "../src/agent-model-binding.js";

function snapshot(): TeamSnapshot { return { id: randomUUID(), mode: "same-model-team", status: "planning", lead: { provider: "mock", model: "mock", connection: "local", reasoning: "balanced" }, members: [], modelTurns: 0, toolCalls: 0, reservedOutputTokens: 0, estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0, unknownUsageRequests: 0 }; }
async function consume(client: ModelClient, signal = new AbortController().signal) { const events: ModelEvent[] = []; for await (const event of client.stream("question", signal)) events.push(event); return events; }
describe("shared team request budget", () => {
  it("stops when native runtime overhead makes observed input exceed the estimate and budget", async () => {
    const state = snapshot(); let calls = 0;
    const native: AgentExecutor = { kind: "agent-executor", identity: { provider: "native-codex", model: "gpt-test", connection: "native-codex" }, capabilities: adapterCapabilities(false, "unknown"), async prepare() {}, async execute() { calls++; return { text: "合成", status: "completed", verification: "unverified", usage: { inputTokens: 9000, outputTokens: 10 } }; } };
    const wrapped = new TeamBudget(teamConfigurationSchema.parse({ maxInputTokens: 8000 }), state, async () => {}).wrap(native, "lead");
    const request = { messages: [{ role: "user" as const, content: "合成" }], maxOutputChars: 1000 };
    await wrapped.execute(request, new AbortController().signal);
    await expect(wrapped.execute(request, new AbortController().signal)).rejects.toThrow("team_budget_exhausted"); expect(calls).toBe(1);
  });
  it("accounts native tasks separately, reserves before dispatch, and stops subsequent calls when observed usage exceeds the target", async () => {
    const state = snapshot(); let calls = 0;
    const native: AgentExecutor = { kind: "agent-executor", identity: { provider: "native-codex", model: "gpt-test", connection: "native-codex" }, capabilities: adapterCapabilities(false, "unknown"), async prepare() {}, async execute(request) {
      expect(state.nativeTasks).toBe(1); expect(request.maxOutputChars).toBeLessThanOrEqual(8192); calls++;
      return { text: "合成", status: "completed", verification: "unverified", usage: { inputTokens: 10, outputTokens: 17000 } };
    } };
    const budget = new TeamBudget(teamConfigurationSchema.parse({}), state, async () => {});
    const wrapped = budget.wrap(native, "lead");
    expect(wrapped.kind).toBe("agent-executor"); expect("stream" in wrapped).toBe(false);
    const request = { messages: [{ role: "user" as const, content: "合成" }], maxOutputChars: 16000 };
    await wrapped.execute(request, new AbortController().signal);
    expect(state).toMatchObject({ nativeTasks: 1, modelTurns: 0, outputTokens: 17000, unknownUsageRequests: 0, nativeTokenLimit: "observed" });
    await expect(wrapped.execute(request, new AbortController().signal)).rejects.toThrow("team_budget_exhausted"); expect(calls).toBe(1);
  });
  it("requires a pinned native model and retains native unknown usage after failure", async () => {
    const state = snapshot();
    const native: AgentExecutor = { kind: "agent-executor", identity: { provider: "native-codex", model: "official-runtime-selected", connection: "native-codex" }, capabilities: adapterCapabilities(false, "unknown"), async prepare() {}, async execute() { throw new Error("native_runtime_failed"); } };
    await expect(bindAgentModel("native-codex", native, "balanced", new AbortController().signal)).rejects.toThrow("native_model_required");
    const budget = new TeamBudget(teamConfigurationSchema.parse({}), state, async () => {});
    await expect(budget.wrap(native, "member").execute({ messages: [{ role: "user", content: "合成" }], maxOutputChars: 1000 }, new AbortController().signal)).rejects.toThrow("native_runtime_failed");
    expect(state).toMatchObject({ nativeTasks: 1, modelTurns: 0, unknownUsageRequests: 1, reservedOutputTokens: 4096 });
  });
  it("does not make a paid request when durable reservation fails", async () => {
    let calls = 0; const client: ModelClient = { async *stream() { calls++; yield { type: "done" }; } };
    const budget = new TeamBudget(teamConfigurationSchema.parse({}), snapshot(), async () => { throw new Error("storage_failed"); });
    for (let i = 0; i < 2; i++) await expect(consume(budget.wrap(client, "lead"))).rejects.toThrow("storage_failed");
    expect(calls).toBe(0);
  });
  it("reserves before dispatch, preserves final capacity and counts missing usage conservatively", async () => {
    const state = snapshot(); let persisted = 0; let calls = 0;
    const budget = new TeamBudget(teamConfigurationSchema.parse({ maxOutputTokens: 4096 }), state, async () => { persisted++; });
    const client: ModelClient = { async *stream() { expect(persisted).toBeGreaterThan(calls); calls++; yield { type: "done" }; } };
    await consume(budget.wrap(client, "member"));
    await expect(consume(budget.wrap(client, "member"))).rejects.toThrow("team_budget_exhausted");
    await consume(budget.wrap(client, "lead"));
    expect(state.modelTurns).toBe(2); expect(state.unknownUsageRequests).toBe(2); expect(state.reservedOutputTokens).toBe(4096);
  });
  it("serializes one Pi connection, releases on failure, and never dispatches cancelled waiters", async () => {
    const state = snapshot(); const budget = new TeamBudget(teamConfigurationSchema.parse({}), state, async () => {});
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let started = 0;
    const client: ModelClient = { identity: { provider: "pi-codex", model: "gpt-test", connection: "pi:openai-codex" }, async *stream() { started++; await gate; yield { type: "done" }; } };
    const first = consume(budget.wrap(client, "member"));
    await new Promise(resolve => setTimeout(resolve, 5));
    const abort = new AbortController(); const second = consume(budget.wrap(client, "member"), abort.signal);
    abort.abort(); await expect(second).rejects.toThrow(); release(); await first; expect(started).toBe(1);
    await consume(budget.wrap(client, "lead")); expect(started).toBe(2);
  });
  it("refunds only reported unused output and blocks excessive tool calls before tools execute", async () => {
    const state = snapshot(); const budget = new TeamBudget(teamConfigurationSchema.parse({ maxToolCalls: 1 }), state, async () => {});
    const client: ModelClient = { async *stream() { yield { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } }; yield { type: "tool_call", tool: "read" }; yield { type: "tool_call", tool: "write" }; yield { type: "done" }; } };
    await expect(consume(budget.wrap(client, "lead"))).rejects.toThrow("team_tool_budget_exhausted");
    expect(state.reservedOutputTokens).toBe(20); expect(state.outputTokens).toBe(20); expect(state.modelTurns).toBe(1);
  });
});
