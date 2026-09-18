import { expect, it } from "vitest";
import { teamStageDiagnostics, type StageRequest } from "../src/team-stage-diagnostics.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";
import { TeamCoordinator } from "../src/team-coordinator.js";
import type { ModelClient } from "../src/model.js";
const request = (phase: StageRequest["phase"], extra: Partial<StageRequest> = {}): StageRequest => ({ phase, durationMs: 10, completed: true, usage: { inputTokens: 100, outputTokens: 20 }, ...extra });
it("reports stage completion and known versus unknown cost without treating concurrent sums as wall time", () => {
  const result = teamStageDiagnostics([request("planning"), request("member"), request("member", { completed: false, usage: undefined, reportIssue: "invalid" }), request("review"), request("followup"), request("review"), request("answer")]);
  expect(result.stages.find(stage => stage.phase === "member")).toMatchObject({ requests: 2, completed: 1, reportShapeFailures: 1, unknownUsageRequests: 1, knownOutputTokens: 20, summedRequestMs: 20 });
  expect(result.correction).toMatchObject({ followupRequests: 1, recheckRequests: 1, summedRequestMs: 20, knownOutputTokens: 40 });
  expect(result.interpretation).toContain("不等于"); expect(result.semanticQuality).toBe("requires_review");
});
it("leaves absent packet and quality evidence unknown rather than claiming perfect completeness", () => {
  const result = teamStageDiagnostics([request("answer")]);
  expect(result.packet).toBeNull(); expect(result.acceptance).toBeNull();
  expect(result.correction.followupRequests).toBe(0); expect(result.semanticQuality).toBe("requires_review");
});
it("preserves source-bound anchors in planning, independent members, targeted follow-up and review", async () => {
  const calls: { phase: string; text: string }[] = [];
  const client: ModelClient = { identity: { provider: "mock", model: "fixture", connection: "fixture" }, async *stream(_prompt, _signal, options) {
    const system = options?.messages?.filter(message => message.role === "system").map(message => message.content).join("\n") ?? "";
    const phase = ["PLAN", "FOLLOWUP", "MEMBER", "REVIEW"].find(phase => system.includes(`TEAM_${phase}`)) ?? "FINAL";
    calls.push({ phase, text: JSON.stringify(options?.messages) });
    const text = phase === "PLAN" ? '{"tasks":["独立推导","核对边界"]}' : phase === "REVIEW" ? JSON.stringify({ verdict: "needs-check", issues: ["检查缓存命中条件"], guidance: "按原始条件核对", followUp: { member: 2, question: "核对约束保留" } }) : ["MEMBER", "FOLLOWUP"].includes(phase) ? JSON.stringify({ summary: "仅比较缓存命中", claims: [{ key: "scope", value: "hit", basis: "原始用户约束" }], uncertainties: [] }) : "仅比较缓存命中组，不外推全体。";
    yield { type: "text_delta", text }; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 10 } }; yield { type: "done" };
  } };
  const source = { id: crypto.randomUUID(), role: "user" as const, text: "约束：只比较缓存命中，不能外推全部请求。", createdAt: new Date().toISOString(), status: "completed" as const };
  const question = "继续核查。", signal = new AbortController().signal;
  const coordinator = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team", shareContext: true }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "fixture", question, save: async () => {} }, signal);
  await coordinator.run({ runId: crypto.randomUUID(), providerId: "mock", client, prompt: question, question, messages: [{ role: "user", content: question }], conversationHistory: [source], contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {} }, signal);
  for (const phase of ["PLAN", "MEMBER", "FOLLOWUP", "REVIEW", "FINAL"]) { const entries = calls.filter(call => call.phase === phase); expect(entries.length).toBeGreaterThan(0); for (const call of entries) { expect(call.text).toContain(source.text); expect(call.text).toContain(source.id); } }
  expect(coordinator.snapshot.packet?.context?.anchors.items).toHaveLength(1);
});
