import { expect, it } from "vitest";
import { evaluateQuality } from "../src/quality-evaluation.js";
import { qualityReportHash, reviewQuality, summarizeQuality } from "../src/quality-review.js";
const fixture = async () => evaluateQuality([{ id: "D1", prompt: "解释原因和边界", criteria: ["数值正确"] }], ["model"], 1, async () => ({ status: "completed", text: '{"answer":4,"explanation":"数值为4，但推导使用了不成立的独立性假设。"}' }));
const dimension = (score: number) => ({ score, rationale: "合成评分，检查来源约束，不是实际人类评阅。", quotes: ["不成立的独立性假设"] });
const input = (report: Awaited<ReturnType<typeof fixture>>) => ({ version: 2, rubricVersion: "explanation-v1", reportHash: qualityReportHash(report), reviewer: { name: "synthetic", kind: "development_assistant", independent: false }, scores: [{ provider: "model", id: "D1", repetition: 1, criteria: ["pass"], rationale: "结果字段对，但解释错", failures: ["accuracy"], dimensions: { correctness: dimension(1), completeness: dimension(2), clarity: dimension(4) } }] });
it("separates explanation accuracy from formatting and field success", async () => {
  const report = await fixture(); const review = reviewQuality(report, input(report));
  expect(review.scores[0]).toMatchObject({ criteriaVerdict: "pass", verdict: "fail", dimensions: { correctness: { score: 1 }, clarity: { score: 4 } } });
  expect(summarizeQuality(report, review)).toMatchObject({ passed: 0, dimensionReview: { reviewed: 1, unreviewed: 0, means: { correctness: 1, completeness: 2, clarity: 4 } } });
});
it("requires all three separately justified scores with real excerpts from the answer", async () => {
  const report = await fixture(); const raw = input(report);
  expect(() => reviewQuality(report, { ...raw, scores: [{ ...raw.scores[0], dimensions: { correctness: dimension(4) } }] })).toThrow();
  expect(() => reviewQuality(report, { ...raw, scores: [{ ...raw.scores[0], dimensions: { ...raw.scores[0]!.dimensions, clarity: { ...dimension(4), quotes: ["fabricated quote"] } } }] })).toThrow("review_quote_mismatch");
  expect(() => reviewQuality(report, { ...raw, rubricVersion: "different" })).toThrow();
});
it("retains legacy reviews as dimension-unscored, never upgrades them by explanation length", async () => {
  const report = await fixture(); const raw = input(report);
  const review = reviewQuality(report, { version: 1, reportHash: raw.reportHash, reviewer: raw.reviewer, scores: raw.scores.map(({ dimensions, ...score }) => { void dimensions; return score; }) });
  expect(summarizeQuality(report, review).dimensionReview).toMatchObject({ reviewed: 0, unreviewed: 1, means: { correctness: null, completeness: null, clarity: null } });
});
