import { z } from "zod/v4";
export const teamEvaluationSelectionSchema = z.object({
  suite: z.enum(["pilot", "holdout", "regression", "quality", "expanded"]),
  caseIds: z.array(z.string().regex(/^[DHQX][0-9]{2}$/)).min(1).max(16).refine(ids => new Set(ids).size === ids.length).optional(),
  repetitions: z.number().int().min(1).max(2).optional(),
}).strict();
export type TeamEvaluationSelection = z.infer<typeof teamEvaluationSelectionSchema>;
