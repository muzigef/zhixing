import { z } from "zod/v4";

/** Pure data contract; importing it does not load context policy into a UI adapter. */
export const conversationAnchorsSchema = z.object({
  authority: z.literal("verbatim_user_statements_not_verified_facts"),
  items: z.array(z.object({ kind: z.enum(["goal", "constraint", "correction", "pending"]), messageId: z.string().min(1).max(128), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), line: z.number().int().positive(), text: z.string().max(700), truncated: z.boolean() }).strict()).max(12).refine(items => items.reduce((sum, item) => sum + item.text.length, 0) <= 6000),
  omittedStatements: z.number().int().nonnegative(), notice: z.string().max(500),
}).strict();
export type ConversationAnchors = z.infer<typeof conversationAnchorsSchema>;
