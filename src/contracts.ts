import { z } from "zod";

export const topicIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "topicId 必须为 kebab-case");
export type TopicId = z.infer<typeof topicIdSchema>;

export const memoryTypeSchema = z.enum(["profile", "learning_fact", "mistake", "knowledge_card", "episodic"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const reviewOutcomeSchema = z.enum(["advance", "reinforce", "repair"]);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export interface TopicDefinition {
  readonly topicId: TopicId;
  readonly title: string;
  readonly planPath: string;
  readonly skillRoot: string;
  readonly prerequisites: readonly { topicId: TopicId; requiredDays: readonly string[] }[];
}

export interface Citation {
  readonly topicId: TopicId;
  readonly documentId: string;
  readonly documentName: string;
  readonly pageNumber: number | null;
  readonly anchor: string | null;
}

export interface SearchResult {
  readonly text: string;
  readonly citation: Citation;
  readonly score: number;
}

export interface MemoryInput {
  readonly topicId: TopicId;
  readonly type: MemoryType;
  readonly content: string;
  readonly sourceKind: "user" | "review" | "document";
  readonly sourceRef: string;
  readonly confidence: number;
  readonly confirmed: boolean;
}
