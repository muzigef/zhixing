import { expect, it } from "vitest";
import { scoreTeamAnswer, teamHoldoutCases } from "../src/team-evaluation-cases.js";
import { evaluateTeams, summarizeTeamEvaluation, type EvaluationRow } from "../src/team-evaluation.js";
import type { ModelClient } from "../src/model.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
    expect(prompts.join("\n")).not.toContain("expected");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
