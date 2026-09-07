import { z } from "zod";

export const outcomeModeSchema = z.enum(["zhixing", "direct"]);
export const outcomePhaseSchema = z.enum(["pre", "post", "delayed"]);
export const outcomeSubmissionSchema = z.object({
  answers: z.array(z.number().int().min(-1).max(2)).length(3),
  explanation: z.string().trim().min(1).max(2000),
  assistance: z.enum(["independent", "hint", "solution"]),
}).strict();
export type OutcomeMode = z.infer<typeof outcomeModeSchema>;
export type OutcomePhase = z.infer<typeof outcomePhaseSchema>;
export type OutcomeSubmission = z.infer<typeof outcomeSubmissionSchema>;
export interface OutcomeResult extends OutcomeSubmission {
  formId: number;
  correctCount: number; total: number; submittedAt: string; elapsedMs: number;
  explanationReview: "pending_human_review";
}
export interface LessonEvidence {
  sessionId: string;
  conditions: { provider: string; model?: string; reasoning: string; style: string }[];
  completedTurns: number; failedTurns: number; durationMs: number;
}
export interface OutcomeView {
  id: string; topicId: string; mode: OutcomeMode; bankVersion: number; title: string;
  stage: OutcomePhase | "lesson" | "waiting" | "complete" | "abandoned";
  repeated: boolean; createdAt: string; reviewAt?: string; sessionId?: string;
  questions: { title: string; choices: string[] }[];
  results: Partial<Record<OutcomePhase, OutcomeResult>>;
  lesson?: LessonEvidence; feedback?: string[];
}
export interface OutcomeSummary {
  conclusion: "descriptive_only"; total: number; incomplete: number;
  exclusions: Record<string, number>;
  groups: { label: string; mode: OutcomeMode; independentPairs: number; retentionPairs: number; scoreChange: number | null; retentionChange: number | null }[];
}

export const lessonEvidenceSchema = z.object({
  sessionId: z.string().uuid(),
  conditions: z.array(z.object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(128).optional(), reasoning: z.string().max(32), style: z.string().max(32) })).min(1).max(1000),
  completedTurns: z.number().int().nonnegative(), failedTurns: z.number().int().nonnegative(), durationMs: z.number().finite().nonnegative(),
});
export const outcomeResultSchema = outcomeSubmissionSchema.extend({
  formId: z.number().int().min(0).max(2), correctCount: z.number().int().min(0).max(3), total: z.literal(3),
  submittedAt: z.string().datetime(), elapsedMs: z.number().finite().nonnegative(), explanationReview: z.literal("pending_human_review"),
});
export const outcomeViewSchema = z.object({
  id: z.string().uuid(), topicId: z.enum(["agent-development", "rag"]), mode: outcomeModeSchema, bankVersion: z.literal(1), title: z.string().min(1).max(200),
  stage: z.enum(["pre", "lesson", "post", "waiting", "delayed", "complete", "abandoned"]), repeated: z.boolean(),
  createdAt: z.string().datetime(), reviewAt: z.string().datetime().optional(), sessionId: z.string().uuid().optional(),
  questions: z.array(z.object({ title: z.string().max(500), choices: z.array(z.string().max(500)).length(3) })).max(3),
  results: z.object({ pre: outcomeResultSchema.optional(), post: outcomeResultSchema.optional(), delayed: outcomeResultSchema.optional() }),
  lesson: lessonEvidenceSchema.optional(), feedback: z.array(z.string().max(1000)).max(3).optional(),
});
export const outcomeExportSchema = z.object({ version: z.literal(1), exportedAt: z.string().datetime(), topicId: z.enum(["agent-development", "rag"]), assignment: z.literal("learner_selected"), trials: z.array(outcomeViewSchema).max(50) });
