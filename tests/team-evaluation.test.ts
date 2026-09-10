import { expect, it } from "vitest";
import { scoreTeamAnswer, teamHoldoutCases } from "../src/team-evaluation-cases.js";
import { evaluateTeams, summarizeTeamEvaluation, type EvaluationRow } from "../src/team-evaluation.js";
import type { ModelClient } from "../src/model.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixtureTeamReport, fixtureTeamReview } from "./team-fixtures.js";

it("uses the standard even-sample median while retaining failed runs in the count", () => {
  const row = (durationMs: number, completed: boolean): EvaluationRow => ({ caseId: "D01", repeat: 1, arm: "single-pi", completed, durationMs, firstTokenMs: null, text: "", turns: [], requests: [], grade: { parsed: true, fields: { value: true }, score: 1, correct: true, explanationPresent: true } });
  const group = summarizeTeamEvaluation([row(10, true), row(30, false)])[0]!;
  expect(group).toMatchObject({ count: 2, completed: 1, fullySuccessful: 1, medianMs: 20, p95Ms: 30 });
});

it("scores numerical, ordering and source constraints without treating zero as 1e-9 or source order as evidence quality", () => {
  for (const item of teamHoldoutCases) expect(scoreTeamAnswer(item, JSON.stringify({ ...item.expected, explanation: "这个合成解释只用于测试确定性评分器是否正确识别答案字段。" })).correct).toBe(true);
  const source = teamHoldoutCases.find(item => item.id === "H04")!;
  expect(scoreTeamAnswer(source, JSON.stringify({ ...source.expected, sources: ["乙", "甲"] })).correct).toBe(true);
  const infinite = teamHoldoutCases.find(item => item.id === "H07")!;
  expect(scoreTeamAnswer(infinite, JSON.stringify({ ...infinite.expected, finiteNineDigitGap: 0 })).correct).toBe(false);
  expect(scoreTeamAnswer(infinite, "模型未完成").score).toBe(0);
});
it("keeps every planned arm in the denominator, records errors and never sends oracle answers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-evaluation-test-"));
  const prompts: string[] = [];
  const client: ModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(prompt) { prompts.push(prompt); if (prompts.length > 1) throw new Error("synthetic_failure"); yield { type: "text_delta", text: '{"value":323,"explanation":"通过20乘17再减去17，得到323，这是整数拆分的计算。"}' }; yield { type: "done" }; } };
  try {
    const result = await evaluateTeams({ root, suite: "pilot", resolve: provider => ({ ...client, identity: { provider, model: provider, connection: "local" } }), signal: new AbortController().signal });
    expect(result.rows).toHaveLength(12); expect(result.rows.some(row => !row.completed)).toBe(true);
    expect(result.summary.every(group => group.count === 2)).toBe(true);
    expect(result.rows.flatMap(row => row.requests).some(request => request.failureCode === "unknown")).toBe(true);
    expect(prompts.join("\n")).not.toContain("expected");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("records review requests and matches the normal five-request team with a five-turn single-agent control", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-regression-test-"));
  const client: ModelClient = { async *stream(_prompt, _signal, options) {
    const system = options?.messages?.filter(item => item.role === "system").map(item => item.content).join("\n") ?? "";
    const text = system.includes("TEAM_PLAN") ? '{"tasks":["计算","检查边界"]}' : system.includes("TEAM_MEMBER") ? fixtureTeamReport : system.includes("TEAM_REVIEW") ? fixtureTeamReview : '{"answer":4,"explanation":"固定测试输出，只验证评测调用与计时，不证明教学质量。"}';
    yield { type: "text_delta", text }; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } }; yield { type: "done" };
  } };
  try {
    const result = await evaluateTeams({ root, suite: "regression", resolve: provider => ({ ...client, identity: { provider, model: provider, connection: provider } }), signal: new AbortController().signal });
    expect(result.rows).toHaveLength(8);
    expect(result.version).toBe(4); expect(result.teamProtocol).toBe(3);
    expect(result.memberReasoning).toEqual({ "pi-codex": "balanced", "deepseek-api": "balanced", "kimi-api": "balanced" });
    for (const member of result.rows.flatMap(row => row.turns.flatMap(turn => turn.team?.members ?? []))) expect(member.binding.reasoning).toBe(result.memberReasoning[member.binding.provider]);
    expect(result.rows.find(row => row.arm === "self-review-pi")?.turns).toHaveLength(5);
    expect(result.rows.find(row => row.arm === "same-team")?.requests.map(request => request.phase)).toEqual(["planning", "member", "member", "review", "answer"]);
    expect(result.limits).toMatchObject({ memberDeadlineMs: 180_000, totalOutputTokensPerArm: 16_384 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("records safe report schema diagnostics for synthetic member requests without storing rejected output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-report-diagnostic-test-"));
  const client: ModelClient = { async *stream(_prompt, _signal, options) {
    const system = options?.messages?.filter(item => item.role === "system").map(item => item.content).join("\n") ?? "";
    const text = system.includes("TEAM_PLAN") ? '{"tasks":["计算","边界"]}' : system.includes("TEAM_MEMBER")
      ? '{"summary":"PRIVATE_REJECTED_REPORT","claims":[{"key":"answer","value":4,"basis":"PRIVATE_REJECTED_REPORT"}],"uncertainties":[]}'
      : system.includes("TEAM_REVIEW") ? fixtureTeamReview : '{"value":4,"explanation":"固定合成回答，仅验证诊断记录。"}';
    yield { type: "text_delta", text }; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } }; yield { type: "done" };
  } };
  try {
    const result = await evaluateTeams({ root, suite: "regression", resolve: provider => ({ ...client, identity: { provider, model: provider, connection: provider } }), signal: new AbortController().signal });
    const members = result.rows.flatMap(row => row.requests).filter(request => request.phase === "member");
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(request => request.reportIssue?.includes("claims.0.value"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REJECTED_REPORT");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
