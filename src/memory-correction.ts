import { createHash } from "node:crypto";
import { z } from "zod/v4";

export const memoryCorrectionSchema = z.object({ id: z.string().min(1).max(128), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().trim().min(1).max(4000) }).strict();
export type MemoryCorrection = z.infer<typeof memoryCorrectionSchema>;
export const memoryContentHash = (content: string) => createHash("sha256").update(content).digest("hex");
