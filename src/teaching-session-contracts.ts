import { z } from "zod/v4";
export const teachingStageSchema = z.enum(["answer_questions", "practice", "reflection"]);
export type TeachingStage = z.infer<typeof teachingStageSchema>;
export const teachingSessionSchema = z.object({
  topicId: z.string().min(1),
  dayId: z.string().regex(/^D\d{2}$/).optional(),
  dayCard: z.string().min(1).max(20_000),
  stage: teachingStageSchema,
  quizRound: z.number().int().min(0).max(20).default(0),
  /** Bounded lesson continuity needed to answer/grade after a REPL restart. */
  transcript: z.array(z.string().min(1).max(8_000)).max(12).default([]),
  currentExercise: z.string().max(8_000).optional(),
  learnerAttempts: z.array(z.string().min(1).max(4_000)).max(8).default([]),
  updatedAt: z.string().datetime(),
});
export type TeachingSession = z.infer<typeof teachingSessionSchema>;
export type TeachingSessionInput = Omit<TeachingSession, "topicId" | "updatedAt" | "transcript" | "learnerAttempts"> & Partial<Pick<TeachingSession, "transcript" | "learnerAttempts">>;


export function teachingCheckpoint(topicId: string, session: TeachingSessionInput): TeachingSession {
  const bounded = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit - 12)}\n[上下文已截断]`;
  return teachingSessionSchema.parse({ ...session, topicId, updatedAt: new Date().toISOString(),
    transcript: session.transcript?.slice(-12).map(text => bounded(text, 8000)),
    learnerAttempts: session.learnerAttempts?.slice(-8).map(text => bounded(text, 4000)) });
}
