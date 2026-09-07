import { expect, it } from "vitest";
import { mergeOutcomeExports } from "../src/outcome-report.js";
import { ZhixingDatabase } from "../src/database.js";
import { LearningOutcomeStore } from "../src/learning-outcomes.js";

function sample() {
  const db = new ZhixingDatabase(":memory:");
  try { const store = new LearningOutcomeStore(db); const trial = store.start("rag", "zhixing"); return { version: 1, exportedAt: new Date().toISOString(), topicId: "rag", assignment: "learner_selected", trials: [trial] }; }
  finally { db.close(); }
}
it("deduplicates repeated exports and backup copies rather than inventing extra participants", () => {
  const report = sample(); const merged = mergeOutcomeExports([report, report]);
  expect(merged.summary.total).toBe(1); expect(merged.duplicates).toBe(1);
  expect(merged.summary.conclusion).toBe("descriptive_only");
});
it("rejects conflicting identities, future formats and cross-topic imported records", () => {
  const report = sample();
  expect(() => mergeOutcomeExports([report, { ...report, trials: [{ ...report.trials[0], mode: "direct" }] }])).toThrow("outcome_export_conflict");
  expect(() => mergeOutcomeExports([{ ...report, version: 2 }])).toThrow();
  expect(() => mergeOutcomeExports([{ ...report, topicId: "agent-development" }])).toThrow("cross_topic_denied");
});

it("merges later delayed results once and checks scores against the versioned question bank", () => {
  const file = sample(); const base = file.trials[0]!;
  const result = { answers: [-1, -1, -1], explanation: "合成答卷，仅用于验证统计。", assistance: "independent", formId: 0, correctCount: 0, total: 3, submittedAt: "2026-09-07T00:00:00.000Z", elapsedMs: 1000, explanationReview: "pending_human_review" };
  const trial = { ...base, stage: "waiting", results: { pre: result, post: { ...result, formId: 1, answers: [0, 2, 1], correctCount: 3 } }, lesson: { sessionId: base.id, conditions: [{ provider: "pi-codex", model: "fixture", reasoning: "balanced", style: "adaptive" }], completedTurns: 1, failedTurns: 0, durationMs: 1000 } };
  const early = { ...file, exportedAt: "2026-09-07T01:00:00.000Z", trials: [trial] };
  const later = { ...early, exportedAt: "2026-09-10T01:00:00.000Z", trials: [{ ...trial, stage: "complete", results: { ...trial.results, delayed: { ...result, formId: 2, answers: [2, 1, -1], correctCount: 2, submittedAt: "2026-09-10T00:00:00.000Z" } } }] };
  for (const files of [[early, later], [later, early]]) {
    const report = mergeOutcomeExports(files);
    expect(report.summary.groups[0]).toMatchObject({ independentPairs: 1, retentionPairs: 1, scoreChange: 100 });
    expect(report.summary.groups[0]?.retentionChange).toBeCloseTo(200 / 3);
  }
  expect(() => mergeOutcomeExports([{ ...early, trials: [{ ...trial, results: { pre: { ...result, correctCount: 3 } } }] }])).toThrow("outcome_export_invalid_score");
});
