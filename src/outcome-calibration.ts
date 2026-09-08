import { createHash } from "node:crypto";
import type { OutcomeResult, OutcomeView, ScoreDistribution } from "./outcome-contracts.js";

export function scoreDistribution(values: number[]): ScoreDistribution {
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return { count: values.length, mean, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    standardDeviation: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean!) ** 2, 0) / (values.length - 1)) : null };
}
export function explanationSourceHash(trial: Pick<OutcomeView, "topicId" | "id">, phase: string, result: OutcomeResult): string {
  return createHash("sha256").update(JSON.stringify([trial.topicId, trial.id, phase, result.answers, result.explanation, result.assistance, result.submittedAt])).digest("hex");
}
export function validateExplanationReviews(trial: OutcomeView): void {
  for (const [phase, result] of Object.entries(trial.results)) {
    const reviews = result.reviews ?? [];
    if (reviews.some((review, index) => review.sourceHash !== explanationSourceHash(trial, phase, result) || review.revision !== index + 1)) throw new Error("outcome_review_source_invalid");
    const expected = !reviews.length ? "pending_human_review" : reviews.at(-1)!.verdict === "withdrawn" ? "withdrawn" : "human_reviewed";
    if (result.explanationReview !== expected) throw new Error("outcome_review_source_invalid");
  }
}
export function outcomeCalibration(trials: OutcomeView[]) {
  const forms = new Map<string, { topicId: string; bankVersion: number; formId: number; phase: string; mode: string; conditions: string; scores: number[] }>();
  const reviews = { pending: 0, singleReviewed: 0, doubleReviewed: 0, agreements: 0, disagreements: 0, reviewerIdentity: "self_reported" as const };
  for (const trial of trials) for (const [phase, result] of Object.entries(trial.results)) {
    const latest = new Map((result.reviews ?? []).map(review => [review.reviewer, review.verdict]));
    const active = [...latest.values()].filter(verdict => verdict !== "withdrawn");
    if (!active.length) reviews.pending++;
    else if (active.length === 1) reviews.singleReviewed++;
    else { reviews.doubleReviewed++; if (new Set(active).size === 1) reviews.agreements++; else reviews.disagreements++; }
    if (trial.repeated || result.assistance !== "independent" || !trial.lesson || trial.lesson.conditions.some(c => c.provider === "demo" || !c.model) || new Set(trial.lesson.conditions.map(c => JSON.stringify(c))).size !== 1) continue;
    const dimensions = { topicId: trial.topicId, bankVersion: trial.bankVersion, formId: result.formId, phase, mode: trial.mode, conditions: JSON.stringify([trial.protocol ?? "prompt_only", trial.lesson.conditions[0]]) };
    const key = JSON.stringify(dimensions), entry = forms.get(key) ?? { ...dimensions, scores: [] };
    entry.scores.push(100 * result.correctCount / result.total); forms.set(key, entry);
  }
  return { status: "uncalibrated" as const, forms: [...forms.values()].map(({ scores, ...dimensions }) => ({ ...dimensions, records: scores.length, meanScore: scoreDistribution(scores).mean })), reviews,
    interpretation: "题卷按阶段、方式和模型条件分别描述；差异可能来自样本与教学，不能据此证明等难度。标准差描述记录间差异，不是置信区间；身份与独立性尚未核验。" };
}
