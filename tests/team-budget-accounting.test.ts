import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TeamBudget } from "../src/team-budget.js";
import { teamConfigurationSchema, teamSnapshotSchema, type TeamSnapshot } from "../src/team-contracts.js";
import { teamBudgetAccounting } from "../src/team-budget-ledger.js";
import type { ModelClient } from "../src/model.js";
const signal = () => new AbortController().signal;
function snapshot(): TeamSnapshot { return { id: randomUUID(), mode: "same-model-team", status: "running", lead: { provider: "mock", model: "fixture", connection: "fixture", reasoning: "quick" }, members: [], modelTurns: 0, toolCalls: 0, reservedOutputTokens: 0, estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0, unknownUsageRequests: 0 }; }
async function consume(client: ModelClient, prompt: string) { for await (const event of client.stream(prompt, signal())) void event; }
it("adds known usage and each unresolved reservation instead of taking the maximum of unrelated totals", async () => {
  const state = snapshot(), budget = new TeamBudget(teamConfigurationSchema.parse({ maxInputTokens: 8000, maxOutputTokens: 48000 }), state, async () => {});
  let first = true, calls = 0;
  const client: ModelClient = { async *stream() { calls++; if (first) { first = false; yield { type: "usage", usage: { inputTokens: 5000, outputTokens: 10 } }; } yield { type: "done" }; } };
  await consume(budget.wrap(client, "lead"), "a".repeat(9000));
  await expect(consume(budget.wrap({ async *stream() { calls++; yield { type: "done" }; } }, "lead"), "a".repeat(12000))).rejects.toThrow("team_budget_exhausted");
  expect(calls).toBe(1); expect(teamBudgetAccounting(state).knownInputTokens).toBe(5000);
});
it("retains unknown reservations after restart and validates ledger/counter consistency", async () => {
  const state = snapshot(), config = teamConfigurationSchema.parse({ maxInputTokens: 8000, maxOutputTokens: 48000 });
  const unknown: ModelClient = { async *stream() { yield { type: "done" }; } };
  await consume(new TeamBudget(config, state, async () => {}).wrap(unknown, "lead"), "x".repeat(9000));
  const stored = teamSnapshotSchema.parse(JSON.parse(JSON.stringify(state)));
  const report = teamBudgetAccounting(stored); expect(report.unknownUsageRequests).toBe(1); expect(report.unknownInputReserved).toBeGreaterThan(0);
  await expect(consume(new TeamBudget(config, stored, async () => {}).wrap(unknown, "lead"), "x".repeat(18000))).rejects.toThrow("team_budget_exhausted");
  const tampered = structuredClone(stored); tampered.inputTokens = 1;
  expect(() => teamBudgetAccounting(tampered)).toThrow("team_budget_ledger_mismatch");
});
it("preserves legacy ambiguity conservatively and never turns it into exact usage", () => {
  const state = snapshot(); Object.assign(state, { modelTurns: 2, estimatedInputTokens: 4000, inputTokens: 5000, unknownUsageRequests: 1, reservedOutputTokens: 1000 });
  const report = teamBudgetAccounting(state);
  expect(report).toMatchObject({ accountedInputTokens: 9000, knownInputTokens: 5000, unknownInputReserved: 4000, legacyAmbiguous: true });
});
it("rejects fractional and duplicate usage reports and preserves reservations on a missing report", async () => {
  for (const kind of ["fractional", "duplicate"]) {
    const state = snapshot(), budget = new TeamBudget(teamConfigurationSchema.parse({}), state, async () => {});
    const client: ModelClient = { async *stream() { yield { type: "usage", usage: { inputTokens: kind === "fractional" ? 1.5 : 10, outputTokens: 2 } }; if (kind === "duplicate") yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } }; yield { type: "done" }; } };
    await expect(consume(budget.wrap(client, "lead"), "synthetic")).rejects.toThrow("provider_usage_invalid");
    expect(teamBudgetAccounting(state).unknownUsageRequests).toBe(1);
    expect(state.reservedOutputTokens).toBeGreaterThanOrEqual(4096);
  }
});
it("calibrates the next reservation from measured overhead, preserving it across restart", async () => {
  const state = snapshot(), config = teamConfigurationSchema.parse({ maxInputTokens: 8000 }); let calls = 0;
  const client: ModelClient = { async *stream() { calls++; yield { type: "usage", usage: { inputTokens: 4200, outputTokens: 3 } }; yield { type: "done" }; } };
  await consume(new TeamBudget(config, state, async () => {}).wrap(client, "lead"), "tiny");
  const stored = teamSnapshotSchema.parse(JSON.parse(JSON.stringify(state)));
  await expect(consume(new TeamBudget(config, stored, async () => {}).wrap(client, "lead"), "tiny")).rejects.toThrow("team_budget_exhausted");
  expect(calls).toBe(1);
});
it("persists concurrent reservations before dispatch and retains cancellation uncertainty", async () => {
  const state = snapshot(), config = teamConfigurationSchema.parse({ maxOutputTokens: 48000 }); let saved: TeamSnapshot = structuredClone(state);
  const budget = new TeamBudget(config, state, async () => { saved = teamSnapshotSchema.parse(JSON.parse(JSON.stringify(state))); });
  let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; }); let calls = 0;
  const client: ModelClient = { async *stream() { calls++; expect(saved.unknownUsageRequests).toBeGreaterThanOrEqual(calls); await gate; yield { type: "progress", phase: "waiting" }; throw new Error("cancelled"); } };
  const first = consume(budget.wrap(client, "lead"), "synthetic"), second = consume(budget.wrap(client, "lead"), "synthetic");
  const completed = Promise.allSettled([first, second]);
  await new Promise(resolve => setTimeout(resolve, 5)); unblock();
  expect((await completed).every(item => item.status === "rejected")).toBe(true);
  expect(teamBudgetAccounting(saved)).toMatchObject({ unknownUsageRequests: 2, reservedOutputTokens: 8192 });
});
