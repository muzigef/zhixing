import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ZhixingDatabase } from "../src/database.js";
import { LearningOutcomeStore } from "../src/learning-outcomes.js";
import { inspectTeachingReadiness } from "../src/teaching-readiness.js";
import { explanationSourceHash } from "../src/outcome-calibration.js";
const hash = "a".repeat(64);
const criteria = { version: 1, topicId: "rag", protocol: "full_product", codeHash: hash, provider: "deepseek-api", model: "fixture", reasoning: "quick", style: "adaptive", minimumRecords: 1, minimumIndependentReviewers: 2, minimumRetentionHours: 72, minimumLearningMs: 1000, dataOrigin: "synthetic" };
function fixture() {
  const db = new ZhixingDatabase(":memory:"); let now = new Date("2026-09-01T00:00:00.000Z");
  const store = new LearningOutcomeStore(db, () => now);
  const trial = store.start("rag", "zhixing", "full_product"), sessionId = randomUUID();
  const submission = { answers: [-1, -1, -1], explanation: "暂时无法解释。", transferExample: "暂时不会举例。", assistance: "independent" };
  store.submit("rag", trial.id, "pre", submission); store.attachSession("rag", trial.id, sessionId);
  store.bindProvenance("rag", trial.id, { version: 1, kind: "source_snapshot", codeHash: hash, commit: null, dirty: false, capturedAt: now.toISOString(), node: "fixture", platform: "fixture", files: [] });
  now = new Date(now.getTime() + 2000);
  store.finishLesson("rag", trial.id, { sessionId, conditions: [{ provider: "deepseek-api", model: "fixture", reasoning: "quick", style: "adaptive", codeHash: hash }], completedTurns: 1, failedTurns: 0, durationMs: 2000 });
  store.submit("rag", trial.id, "post", submission);
  now = new Date(now.getTime() + 72 * 3600000); store.openRetention("rag", trial.id); store.submit("rag", trial.id, "delayed", submission);
  return { db, store, id: trial.id, submission, exported: () => ({ version: 1, exportedAt: now.toISOString(), topicId: "rag", assignment: "learner_selected", trials: [store.get("rag", trial.id)] }) };
}
it("records transfer separately, binds reviews to it, and retains poor learning outcomes instead of filtering them away", () => {
  const f = fixture();
  try {
    for (const phase of ["pre", "post", "delayed"] as const) for (const reviewer of ["independent-a", "independent-b"]) {
      const result = f.store.get("rag", f.id).results[phase]!;
      f.store.reviewExplanation("rag", f.id, phase, { expectedExplanation: result.explanation, expectedTransferExample: result.transferExample, expectedRevision: result.reviews?.length ?? 0, reviewer, verdict: "unsupported", transferVerdict: "unsupported", declaration: { kind: "human", independent: true }, feedback: "合成研究夹具：该回答尚未掌握，不是未作答。" });
    }
    const trial = f.store.get("rag", f.id); expect(trial.results.post?.transferPrompt).toBeTruthy();
    const report = inspectTeachingReadiness([f.exported()], criteria);
    expect(report).toMatchObject({ recorded: 1, completeRecords: 1, dataCompletenessReady: true, realStudyVerified: false, causalEffectEstablished: false, dataOrigin: "synthetic" });
    expect(report.records[0]).toMatchObject({ ready: true, delayedCorrect: 0, transferVerdicts: ["unsupported", "unsupported"] });
    const changed = f.exported(); changed.trials[0]!.results.post!.transferExample = "changed";
    expect(() => inspectTeachingReadiness([changed], criteria)).toThrow("outcome_review_source_invalid");
    expect(() => f.store.submit("rag", f.id, "post", { ...f.submission, transferExample: "改写例子" })).toThrow("outcome_already_submitted");
  } finally { f.db.close(); }
});
it("reports missing transfer/reviews, early retention and changed conditions without inventing participant identities", () => {
  const f = fixture();
  try {
    const exported = f.exported(), trial = exported.trials[0]!;
    delete trial.results.pre!.transferExample; delete trial.results.pre!.transferPrompt;
    trial.results.delayed!.submittedAt = trial.results.post!.submittedAt;
    trial.lesson!.conditions.push({ ...trial.lesson!.conditions[0]!, model: "changed" });
    const report = inspectTeachingReadiness([exported, exported], criteria);
    expect(report).toMatchObject({ recorded: 1, duplicateExports: 1, completeRecords: 0, participantIdentitiesVerified: false });
    expect(report.records[0]!.problems).toEqual(expect.arrayContaining(["pre:transfer_missing", "pre:independent_double_review_missing", "retention_too_early", "changed_conditions"]));
  } finally { f.db.close(); }
});
it("keeps legacy review hashes stable when no transfer answer was collected", () => {
  const base = { topicId: "rag", id: randomUUID() }, result = { answers: [-1, -1, -1], explanation: "原解释", assistance: "independent" as const, formId: 0, correctCount: 0, total: 3, submittedAt: "2026-09-01T00:00:00.000Z", elapsedMs: 10, explanationReview: "pending_human_review" as const };
  const before = explanationSourceHash(base, "pre", result);
  expect(explanationSourceHash(base, "pre", { ...result, transferExample: "新例子", transferPrompt: "独立的新场景" })).not.toBe(before);
  expect(explanationSourceHash(base, "pre", { ...result })).toBe(before);
});
it("runs the readiness CLI on explicit exported files and preserves an incomplete-data report", async () => {
  const fs = await import("node:fs/promises"), path = await import("node:path"), os = await import("node:os"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-ready-cli-")), f = fixture();
  try {
    await fs.writeFile(path.join(root, "export.json"), JSON.stringify(f.exported())); await fs.writeFile(path.join(root, "criteria.json"), JSON.stringify(criteria));
    const args = ["--import", "tsx", "scripts/check-teaching-readiness.ts", `--criteria=${path.join(root, "criteria.json")}`, `--output=${path.join(root, "result.json")}`, path.join(root, "export.json")];
    await expect(promisify(execFile)(process.execPath, args, { timeout: 10_000 })).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await fs.readFile(path.join(root, "result.json"), "utf8"))).toMatchObject({ completeRecords: 0, dataCompletenessReady: false, causalEffectEstablished: false });
  } finally { f.db.close(); await fs.rm(root, { recursive: true, force: true }); }
});
