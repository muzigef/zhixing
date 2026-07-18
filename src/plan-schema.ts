import { z } from "zod";
import { topicIdSchema } from "./contracts.js";

export const topicPlanSchema = z.object({
  topicId: topicIdSchema,
  title: z.string().min(1),
  version: z.number().int().positive(),
  prerequisites: z.array(z.object({ topicId: topicIdSchema, requiredDays: z.array(z.string().regex(/^D\d{2}$/)).min(1) })),
  days: z.array(z.object({
    id: z.string().regex(/^D\d{2}$/),
    title: z.string().min(1),
    estimatedMinutes: z.number().int().positive(),
    requiredEvidence: z.array(z.enum(["implementation", "test-output", "failure-case", "reflection"])).min(1),
    optional: z.boolean(),
  })).min(1),
}).superRefine((plan, context) => {
  const ids = plan.days.map((day) => day.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Day ID 在主题内必须唯一" });
});

export type TopicPlan = z.infer<typeof topicPlanSchema>;
