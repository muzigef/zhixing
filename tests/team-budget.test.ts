import { describe, expect, it } from "vitest";
import { TeamBudget } from "../src/team-budget.js";
import { teamConfigurationSchema, type TeamSnapshot } from "../src/team-contracts.js";
import type { ModelClient, ModelEvent } from "../src/model.js";
import { randomUUID } from "node:crypto";

function snapshot(): TeamSnapshot { return { id: randomUUID(), mode: "same-model-team", status: "planning", lead: { provider: "mock", model: "mock", connection: "local", reasoning: "balanced" }, members: [], modelTurns: 0, toolCalls: 0, reservedOutputTokens: 0, estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0, unknownUsageRequests: 0 }; }
async function consume(client: ModelClient, signal = new AbortController().signal) { const events: ModelEvent[] = []; for await (const event of client.stream("question", signal)) events.push(event); return events; }
describe("shared team request budget", () => {
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
