import { z } from "zod";
import { topicIdSchema } from "./contracts.js";
import type { TopicPlanDay } from "./plan-loader.js";
import type { AssessmentResult } from "./learning-assessment.js";

export const citationSchema = z.object({
  topicId: topicIdSchema,
  documentId: z.string().uuid(),
  documentName: z.string().max(255),
  pageNumber: z.number().int().positive().nullable(),
  anchor: z.string().max(1000).nullable(),
  chunkId: z.string().uuid().optional(),
});
export interface LearningOverview {
  topicId: string;
  title: string;
  progress: string;
  next: string;
  course: readonly TopicPlanDay[];
  days: { dayId: string; state: "未开始" | "进行中" | "完成" }[];
  materials: { id: string; name: string; status: string; createdAt: string }[];
  assessments?: AssessmentResult[];
}
export interface WorkspaceSummary {
  id: string;
  path: string;
  topics: { topicId: string; title: string }[];
}
export interface LearningSource {
  citation: z.infer<typeof citationSchema>;
  text: string;
  truncated: boolean;
}
