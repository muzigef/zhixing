import { studyBindingSchema, type StudyBinding } from "./teaching-study-contracts.js";
import { z } from "zod/v4";
import { buildProvenanceSchema, type BuildProvenance } from "./build-provenance-contracts.js";
import type { outcomeCalibration } from "./outcome-calibration.js";

export const outcomeModeSchema = z.enum(["zhixing", "direct"]);
export const outcomeProtocolSchema = z.enum(["prompt_only", "full_product"]);
export type OutcomeProtocol = z.infer<typeof outcomeProtocolSchema>;
export function restrictedStudy(study?: { mode: OutcomeMode; protocol?: OutcomeProtocol }): boolean { return Boolean(study && !(study.protocol === "full_product" && study.mode === "zhixing")); }
export const outcomePhaseSchema = z.enum(["pre", "post", "delayed"]);
export const outcomeSubmissionSchema = z.object({
  answers: z.array(z.number().int().min(-1).max(2)).length(3),
  explanation: z.string().trim().min(1).max(2000),
  transferExample: z.string().trim().min(1).max(2000).optional(),
  assistance: z.enum(["independent", "hint", "solution"]),
}).strict();
export type OutcomeMode = z.infer<typeof outcomeModeSchema>;
export type OutcomePhase = z.infer<typeof outcomePhaseSchema>;
export type OutcomeSubmission = z.infer<typeof outcomeSubmissionSchema>;
export const reviewerDeclarationSchema = z.object({ kind: z.enum(["human", "development_assistant"]), independent: z.boolean() }).strict().refine(value => value.kind === "human" || !value.independent);
export const explanationReviewInputSchema = z.object({ expectedExplanation: z.string().max(2000), expectedTransferExample: z.string().max(2000).optional(), declaration: reviewerDeclarationSchema.optional(), transferVerdict: z.enum(["supported", "partial", "unsupported"]).optional(), expectedRevision: z.number().int().min(0).max(100), reviewer: z.string().trim().min(1).max(100), verdict: z.enum(["supported", "partial", "unsupported", "withdrawn"]), feedback: z.string().trim().min(1).max(2000) }).strict();
export const explanationReviewSchema = explanationReviewInputSchema.omit({ expectedExplanation: true, expectedRevision: true, expectedTransferExample: true }).extend({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().positive(), reviewedAt: z.string().datetime() });
export type ExplanationReviewInput = z.infer<typeof explanationReviewInputSchema>;
export interface OutcomeResult extends OutcomeSubmission {
  transferPrompt?: string;
  formId: number;
  correctCount: number; total: number; submittedAt: string; elapsedMs: number;
  explanationReview: "pending_human_review" | "human_reviewed" | "withdrawn";
  reviews?: z.infer<typeof explanationReviewSchema>[];
}
export interface LessonEvidence {
  sessionId: string;
  conditions: { provider: string; model?: string; reasoning: string; style: string; codeHash?: string; windowTokens?: number; reserveOutputTokens?: number }[];
  toolCalls?: number; access?: { materials: boolean; project: boolean; external: boolean }[];
  completedTurns: number; failedTurns: number; durationMs: number;
}
export interface OutcomeView {
  study?: StudyBinding;
  transferPrompt?: string;
  id: string; topicId: string; mode: OutcomeMode; bankVersion: number; title: string;
  protocol?: OutcomeProtocol; provenance?: BuildProvenance;
  stage: OutcomePhase | "lesson" | "waiting" | "complete" | "abandoned";
  repeated: boolean; createdAt: string; reviewAt?: string; sessionId?: string;
  questions: { title: string; choices: string[] }[];
  results: Partial<Record<OutcomePhase, OutcomeResult>>;
  lesson?: LessonEvidence; feedback?: string[];
}
export interface OutcomeSummary {
  conclusion: "descriptive_only"; total: number; incomplete: number;
  exclusions: Record<string, number>;
  calibration: ReturnType<typeof outcomeCalibration>;
  groups: { label: string; mode: OutcomeMode; independentPairs: number; retentionPairs: number; scoreChange: number | null; retentionChange: number | null; missingRetention: number; scoreDistribution: ScoreDistribution; retentionDistribution: ScoreDistribution }[];
}
export interface ScoreDistribution { count: number; mean: number | null; min: number | null; max: number | null; standardDeviation: number | null; }

export const lessonEvidenceSchema = z.object({
  sessionId: z.string().uuid(),
  conditions: z.array(z.object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(128).optional(), reasoning: z.string().max(32), style: z.string().max(32), codeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), windowTokens: z.number().positive().optional(), reserveOutputTokens: z.number().positive().optional() })).min(1).max(1000),
  toolCalls: z.number().int().nonnegative().optional(), access: z.array(z.object({ materials: z.boolean(), project: z.boolean(), external: z.boolean() }).strict()).max(1000).optional(),
  completedTurns: z.number().int().nonnegative(), failedTurns: z.number().int().nonnegative(), durationMs: z.number().finite().nonnegative(),
});
export const outcomeResultSchema = outcomeSubmissionSchema.extend({
  transferPrompt: z.string().min(1).max(1000).optional(),
  formId: z.number().int().min(0).max(2), correctCount: z.number().int().min(0).max(3), total: z.literal(3),
  submittedAt: z.string().datetime(), elapsedMs: z.number().finite().nonnegative(), explanationReview: z.enum(["pending_human_review", "human_reviewed", "withdrawn"]), reviews: z.array(explanationReviewSchema).max(100).optional(),
}).refine(result => (result.transferExample === undefined) === (result.transferPrompt === undefined));
export const outcomeViewSchema = z.object({
  study: studyBindingSchema.optional(),
  transferPrompt: z.string().min(1).max(1000).optional(),
  id: z.string().uuid(), topicId: z.enum(["agent-development", "rag"]), mode: outcomeModeSchema, bankVersion: z.literal(1), title: z.string().min(1).max(200),
  protocol: outcomeProtocolSchema.optional(), provenance: buildProvenanceSchema.optional(),
  stage: z.enum(["pre", "lesson", "post", "waiting", "delayed", "complete", "abandoned"]), repeated: z.boolean(),
  createdAt: z.string().datetime(), reviewAt: z.string().datetime().optional(), sessionId: z.string().uuid().optional(),
  questions: z.array(z.object({ title: z.string().max(500), choices: z.array(z.string().max(500)).length(3) })).max(3),
  results: z.object({ pre: outcomeResultSchema.optional(), post: outcomeResultSchema.optional(), delayed: outcomeResultSchema.optional() }),
  lesson: lessonEvidenceSchema.optional(), feedback: z.array(z.string().max(1000)).max(3).optional(),
});
export const outcomeExportSchema = z.object({ version: z.literal(1), exportedAt: z.string().datetime(), topicId: z.enum(["agent-development", "rag"]), assignment: z.enum(["learner_selected", "randomized", "mixed"]), trials: z.array(outcomeViewSchema).max(50) });

export function outcomeAssignment(trials: OutcomeView[]): "learner_selected" | "randomized" | "mixed" {
  const assigned = trials.filter(trial => trial.study).length;
  return !assigned ? "learner_selected" : assigned === trials.length ? "randomized" : "mixed";
}
