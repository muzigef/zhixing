import { z } from "zod/v4";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const participantCodeSchema = z.string().regex(/^P[0-9]{3,8}$/);
export const teachingStudyPlanSchema = z.object({ version: z.literal(1), topicId: z.enum(["rag", "agent-development"]), protocol: z.literal("full_product"), codeHash: hash, provider: z.string().min(1).max(128), model: z.string().min(1).max(128), reasoning: z.enum(["quick", "balanced", "deep"]), style: z.enum(["concise", "adaptive", "detailed"]), minimumLearningMs: z.number().int().min(0).max(86400000), primaryMetric: z.literal("delayed_correct"), minimumRetentionHours: z.literal(72), plannedParticipants: z.number().int().min(2).max(1000), sampleRationale: z.string().trim().min(20).max(2000), hypothesis: z.string().trim().min(10).max(2000), missingRule: z.enum(["bounds", "zero_imputation"]), dataOrigin: z.enum(["synthetic", "real_declared"]), allocation: z.literal("simple_random_1_to_1") }).strict();
export const studyAssignmentSchema = z.object({ participantCode: participantCodeSchema, trialId: z.string().uuid(), mode: z.enum(["zhixing", "direct"]), assignedAt: z.string().datetime() }).strict();
export const studyTicketSchema = z.object({ version: z.literal(1), plan: teachingStudyPlanSchema, planHash: hash, registryHash: hash, assignment: studyAssignmentSchema, ticketHash: hash }).strict();
export const studyBindingSchema = z.object({ registryHash: hash, planHash: hash, participantCode: participantCodeSchema, assignedAt: z.string().datetime(), ticketHash: hash }).strict();
export type StudyTicket = z.infer<typeof studyTicketSchema>;
export type StudyBinding = z.infer<typeof studyBindingSchema>;
