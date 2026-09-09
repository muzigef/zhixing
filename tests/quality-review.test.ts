import { expect, it } from "vitest";
import { evaluateQuality } from "../src/quality-evaluation.js";
import { reviewQuality, qualityReportHash, summarizeQuality } from "../src/quality-review.js";
import { publicError } from "../src/agent-errors.js";

const cases = [{ id: "H01", prompt: "合成留出题", criteria: ["依据准确", "格式符合要求"] }];
it("counts planned/attempted/completed separately and excludes missing timing and unscored results", async () => {
  let calls = 0;
  const report = await evaluateQuality(cases, ["a", "b"], 2, async provider => { calls++; return provider === "a" ? { status: "completed", text: "合成回答", model: "m", reasoning: "quick", durationMs: 100, firstTokenMs: 20 } : { status: "failed", text: "", error: "provider_failure" }; });
  const summary = summarizeQuality(report);
  expect(calls).toBe(3); expect(summary.planned).toBe(4); expect(summary.attempted).toBe(3); expect(summary.completed).toBe(2); expect(summary.unreviewed).toBe(2); expect(summary.passRate).toBeNull();
  expect(summary.groups.find(group => group.provider === "a")?.latency).toEqual({ samples: 2, p50: 100, p95: 100 });
  expect(summary.failures).toMatchObject({ provider_failure: 1, not_attempted: 1 });
});
it("binds independent human criteria scores to the exact report and rejects duplicate or stale scores", async () => {
  const report = await evaluateQuality(cases, ["a"], 1, async () => ({ status: "completed", text: "合成回答" }));
  const input = { version: 1, reportHash: qualityReportHash(report), reviewer: { name: "测试用评分者", kind: "human", independent: true }, scores: [{ provider: "a", id: "H01", repetition: 1, criteria: ["pass", "partial"], rationale: "合成评分夹具：第二项不完整", failures: ["format"] }] };
  const reviews = reviewQuality(report, input); expect(reviews.scores[0]?.verdict).toBe("partial"); expect(summarizeQuality(report, reviews)).toMatchObject({ reviewed: 1, passed: 0, passRate: 0, independentHumanReviewed: 1 });
  expect(() => reviewQuality({ ...report, startedAt: new Date(0).toISOString() }, input)).toThrow("review_report_mismatch");
  expect(() => reviewQuality(report, { ...input, scores: [...input.scores, ...input.scores] })).toThrow("review_duplicate");
  expect(() => reviewQuality(report, { ...input, reviewer: { ...input.reviewer, kind: "development_assistant" } })).toThrow();
});
it("preserves provider exceptions and does not fabricate later attempts or latency samples", async () => {
  const report = await evaluateQuality(cases, ["a"], 2, async () => { throw new Error("fixture private exception"); });
  expect(JSON.stringify(report)).not.toContain("fixture private exception");
  expect(report.results.map(row => row.attempted)).toEqual([true, false]);
  expect(report.results[1]?.durationMs).toBeUndefined();
  expect(summarizeQuality(report).groups.every(group => group.latency.samples === 0)).toBe(true);
  expect(summarizeQuality(report).failures).toEqual({ evaluation_failure: 1, not_attempted: 1 });
});
it("retains task no-progress failures without declaring the provider unavailable or skipping later cases", async () => {
  for (const error of ["repeated_tool_call", publicError(new Error("repeated_tool_call")), "empty_answer"]) {
    let calls = 0;
    const report = await evaluateQuality(cases, ["a"], 2, async () => ++calls === 1 ? { status: "failed", text: "", error } : { status: "completed", text: "后续合成回答" });
    expect(calls).toBe(2); expect(report.results.map(row => row.attempted)).toEqual([true, true]);
    const summary = summarizeQuality(report);
    expect(summary.completed).toBe(1); expect(summary.unreviewed).toBe(1);
    expect(summary.failures).toEqual({ [error === "empty_answer" ? "empty_answer" : "execution_no_progress"]: 1 });
  }
});
it("does not infer a connection failure from an empty answer and an unclassified error", async () => {
  const report = await evaluateQuality(cases, ["a"], 2, async () => ({ status: "failed", text: "", error: "unknown safe failure" }));
  expect(summarizeQuality(report).failures).toEqual({ unclassified_failure: 1, not_attempted: 1 });
});
it("rejects empty or duplicated datasets and providers before any request", async () => {
  for (const [tasks, providers] of [[[], ["a"]], [[...cases, ...cases], ["a"]], [cases, ["a", "a"]]] as const) await expect(evaluateQuality([...tasks], [...providers], 1, async () => ({ status: "completed", text: "" }))).rejects.toThrow("evaluation_budget_invalid");
});
