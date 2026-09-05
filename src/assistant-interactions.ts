import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { LearningTools } from "./learning-agent.js";

const identity = { id: z.string().uuid() };
const resolution = { status: z.enum(["pending", "answered"]), answer: z.string().max(4000).optional() };
export const assistantItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...identity, kind: z.literal("progress"), text: z.string().max(64_000) }),
  z.object({ ...identity, kind: z.literal("final"), text: z.string().max(64_000) }),
  z.object({ ...identity, ...resolution, kind: z.literal("question"), title: z.string().min(1).max(500), options: z.array(z.string().min(1).max(120)).max(3) }),
  z.object({ ...identity, ...resolution, kind: z.literal("approval"), title: z.string().max(200), tool: z.enum(["save_artifact", "run_experiment"]), input: z.record(z.unknown()) }),
  z.object({ ...identity, kind: z.literal("artifact"), artifactId: z.string().uuid(), dayId: z.string().regex(/^D\d{2}$/), artifactKind: z.string().max(40), text: z.string().max(24_000) }),
]);
export type AssistantItem = z.infer<typeof assistantItemSchema>;
export type PendingInteraction = Extract<AssistantItem, { kind: "approval" | "question" }>;
export function addQuestionTool(base: LearningTools, ask: (item: PendingInteraction) => Promise<void>): LearningTools {
  const input = z.object({ title: z.string().min(1).max(500), options: z.array(z.string().min(1).max(120)).max(3).default([]) }).strict();
  base.harness.register({ name: "ask_user", input, risk: "read", timeoutMs: 5000, idempotent: true, execute: async (value) => {
    const item: PendingInteraction = { id: randomUUID(), kind: "question", status: "pending", title: value.title, options: value.options ?? [] };
    await ask(item); return { waitingForUser: true, questionId: item.id };
  } });
  return { harness: base.harness, definitions: [...base.definitions, { name: "ask_user", description: "仅在缺少关键目标、输入或约束而无法继续时，提出一个清晰短问题，可给最多三个选项。调用后暂停等待用户回复；可自行决定的细节不提问。", inputSchema: { type: "object", properties: { title: { type: "string", maxLength: 500 }, options: { type: "array", maxItems: 3, items: { type: "string", maxLength: 120 } } }, required: ["title"], additionalProperties: false } }] };
}
