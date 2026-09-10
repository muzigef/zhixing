import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { TeamCoordinator } from "../src/team-coordinator.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";
import type { ModelClient, ModelMessage } from "../src/model.js";
import { fixtureTeamReport, fixtureTeamReview } from "./team-fixtures.js";

function fixture() {
  const calls: { kind: string; messages: readonly ModelMessage[] }[] = []; let failing = true;
  const client: ModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(_prompt, _signal, options) {
    const messages = options?.messages ?? []; const system = messages.filter(item => item.role === "system").map(item => item.content).join("\n");
    const kind = /TEAM_(PLAN|MEMBER|REVIEW|FOLLOWUP)/.exec(system)?.[1] ?? "FINAL"; calls.push({ kind, messages });
    if (kind === "MEMBER" && failing && JSON.stringify(messages).includes("failing-task")) throw new Error("provider_unavailable");
    const text = kind === "PLAN" ? JSON.stringify({ tasks: [{ id: "first", member: 1, goal: "initial-task", dependsOn: [], acceptance: ["计算"] }, { id: "second", member: 2, goal: "failing-task", dependsOn: [], acceptance: ["核查"] }] }) : kind === "REVIEW" ? fixtureTeamReview : kind === "MEMBER" || kind === "FOLLOWUP" ? fixtureTeamReport : "结果为 4。";
    yield { type: "text_delta", text }; yield { type: "usage", usage: { inputTokens: 30, outputTokens: 30 } }; yield { type: "done" };
  } };
  const options = { runId: randomUUID(), providerId: "mock", client, prompt: "2+2?", question: "2+2?", messages: [{ role: "user" as const, content: "2+2?" }], contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {} };
  const input = { config: teamConfigurationSchema.parse({ mode: "same-model-team", maxConcurrency: 1 }), provider: "mock" as const, resolve: () => client, reasoning: "balanced" as const, scope: "scope", question: options.question, save: async () => {} };
  return { calls, options, input, healthy: () => { failing = false; } };
}
it("retries only an explicitly selected failed task, preserving successful work and cumulative unknown usage", async () => {
  const f = fixture(); const signal = new AbortController().signal;
  const first = await TeamCoordinator.create(f.input, signal); await first.run(f.options, signal);
  const previous = structuredClone(first.snapshot); const failed = previous.tasks!.find(task => task.status === "failed")!; const successful = previous.tasks!.find(task => task.status === "completed")!;
  f.healthy(); const offset = f.calls.length;
  const resumed = await TeamCoordinator.create({ ...f.input, previous, retryTaskId: failed.id }, signal); await resumed.run(f.options, signal);
  expect(f.calls.slice(offset).map(call => call.kind)).toEqual(["MEMBER", "REVIEW", "FINAL"]);
  expect(resumed.snapshot.tasks!.find(task => task.id === successful.id)).toEqual(successful);
  expect(resumed.snapshot.tasks!.find(task => task.id === failed.id)).toMatchObject({ status: "completed", attempts: 2 });
  expect(resumed.snapshot.tasks!.find(task => task.id === failed.id)?.runs?.map(run => run.status)).toEqual(["failed", "completed"]);
  expect(resumed.snapshot.tasks!.find(task => task.id === failed.id)?.runs?.[0]?.executionId).toBe(failed.executionId);
  expect(resumed.snapshot.unknownUsageRequests).toBe(previous.unknownUsageRequests);
  expect(resumed.snapshot.modelTurns).toBeGreaterThan(previous.modelTurns); expect(resumed.snapshot.status).toBe("completed");
});
it("rejects completed, foreign and exhausted retry targets before any model dispatch", async () => {
  const f = fixture(); const signal = new AbortController().signal; const first = await TeamCoordinator.create(f.input, signal); await first.run(f.options, signal);
  const count = f.calls.length; const previous = structuredClone(first.snapshot);
  await expect(TeamCoordinator.create({ ...f.input, previous, retryTaskId: previous.tasks![0]!.id }, signal)).rejects.toThrow("team_task_not_retryable");
  await expect(TeamCoordinator.create({ ...f.input, previous, retryTaskId: randomUUID() }, signal)).rejects.toThrow("team_task_not_retryable");
  previous.tasks![1]!.attempts = 3;
  await expect(TeamCoordinator.create({ ...f.input, previous, retryTaskId: previous.tasks![1]!.id }, signal)).rejects.toThrow("team_task_not_retryable"); expect(f.calls).toHaveLength(count);
});
it("continues each member's own public task history without leaking unrelated peer work", async () => {
  const f = fixture(); f.healthy(); const original = f.input.resolve(); const signal = new AbortController().signal;
  const client: ModelClient = { ...original, async *stream(prompt, modelSignal, options) {
    if (options?.messages?.some(item => item.role === "system" && item.content.includes("TEAM_PLAN"))) {
      yield { type: "text_delta", text: JSON.stringify({ tasks: [{ id: "first", member: 1, goal: "initial-task", dependsOn: [], acceptance: ["计算"] }, { id: "peer", member: 2, goal: "peer-private-goal", dependsOn: [], acceptance: ["验证"] }, { id: "next", member: 1, goal: "continue-own-task", dependsOn: ["first"], acceptance: ["反例"] }] }) }; yield { type: "done" }; return;
    }
    yield* original.stream(prompt, modelSignal, options);
  } };
  const team = await TeamCoordinator.create({ ...f.input, resolve: () => client }, signal); await team.run({ ...f.options, client }, signal);
  const continuation = f.calls.find(call => call.kind === "MEMBER" && JSON.stringify(call.messages).includes("continue-own-task"))!;
  expect(JSON.stringify(continuation.messages)).toContain("initial-task"); expect(JSON.stringify(continuation.messages)).not.toContain("peer-private-goal");
});
