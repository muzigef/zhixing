import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { summarizeOutcomes } from "../src/learning-outcomes.js";
import { mergeOutcomeExports } from "../src/outcome-report.js";
import type { OutcomeView, OutcomeResult } from "../src/outcome-contracts.js";
const date = "2026-09-08T00:00:00.000Z";
const result = (formId: number, correctCount: number): OutcomeResult => ({ answers: correctCount === 3 ? [0, 2, 1] : [-1, -1, -1], explanation: "合成解释", assistance: "independent", formId, correctCount, total: 3, submittedAt: date, elapsedMs: 1000, explanationReview: "pending_human_review" });
function trial(): OutcomeView {
  const id = randomUUID();
  return { id, topicId: "rag", bankVersion: 1, mode: "zhixing", stage: "waiting", repeated: false, title: "合成测试", createdAt: date, questions: [], results: { pre: result(0, 0), post: result(1, 3) }, lesson: { sessionId: id, conditions: [{ provider: "pi-codex", model: "fixture", reasoning: "balanced", style: "adaptive" }], completedTurns: 1, failedTurns: 0, durationMs: 1000 } };
}
function file(value: OutcomeView, exportedAt = date) { return { version: 1, exportedAt, topicId: "rag", assignment: "learner_selected", trials: [value] }; }
it("reports dispersion, missing retention and uncalibrated form difficulty without inventing certainty", () => {
  const first = trial(), second = trial(); second.results.post = result(1, 0);
  const report = summarizeOutcomes([first, second]);
  expect(report.groups[0]).toMatchObject({ independentPairs: 2, scoreChange: 50, missingRetention: 2, scoreDistribution: { count: 2, min: 0, max: 100, mean: 50 } });
  expect(report.groups[0]?.scoreDistribution.standardDeviation).toBeCloseTo(Math.sqrt(5000));
  expect(report.calibration.status).toBe("uncalibrated");
  expect(report.calibration.forms.find(form => form.phase === "pre")).toMatchObject({ formId: 0, records: 2, meanScore: 0 });
  expect(summarizeOutcomes([first]).groups[0]?.scoreDistribution.standardDeviation).toBeNull();
});
it("accepts append-only review revisions in either export order and reports distinct reviewers' disagreement", () => {
  const before = trial(); before.stage = "abandoned";
  const after = structuredClone(before); const source = after.results.post!;
  const sourceHash = createHash("sha256").update(JSON.stringify([after.topicId, after.id, "post", source.answers, source.explanation, source.assistance, source.submittedAt])).digest("hex");
  source.reviews = [
    { reviewer: "A", verdict: "supported", feedback: "依据完整", sourceHash, revision: 1, reviewedAt: date },
    { reviewer: "B", verdict: "partial", feedback: "迁移例子不充分", sourceHash, revision: 2, reviewedAt: date },
  ]; source.explanationReview = "human_reviewed";
  for (const files of [[file(before), file(after, "2026-09-09T00:00:00.000Z")], [file(after, "2026-09-09T00:00:00.000Z"), file(before)]]) {
    const report = mergeOutcomeExports(files);
    expect(report.summary.calibration.reviews).toMatchObject({ doubleReviewed: 1, agreements: 0, disagreements: 1, pending: 1 });
  }
  const forged = structuredClone(after); forged.results.post!.reviews![0]!.sourceHash = "f".repeat(64);
  expect(() => mergeOutcomeExports([file(forged)])).toThrow("outcome_review_source_invalid");
});
it("rejects rewriting a prior review while permitting a reviewer to withdraw their own rating", () => {
  const before = trial(); before.stage = "abandoned";
  const source = before.results.post!;
  const sourceHash = createHash("sha256").update(JSON.stringify([before.topicId, before.id, "post", source.answers, source.explanation, source.assistance, source.submittedAt])).digest("hex");
  source.reviews = [{ reviewer: "A", verdict: "supported", feedback: "合成反馈", sourceHash, revision: 1, reviewedAt: date }]; source.explanationReview = "human_reviewed";
  const rewritten = structuredClone(before); rewritten.results.post!.reviews![0]!.verdict = "unsupported";
  expect(() => mergeOutcomeExports([file(before), file(rewritten, "2026-09-09T00:00:00.000Z")])).toThrow("outcome_export_conflict");
  const withdrawn = structuredClone(before); withdrawn.results.post!.reviews!.push({ ...source.reviews[0]!, verdict: "withdrawn", revision: 2 }); withdrawn.results.post!.explanationReview = "withdrawn";
  expect(mergeOutcomeExports([file(withdrawn)]).summary.calibration.reviews).toMatchObject({ pending: 2, doubleReviewed: 0 });
});
