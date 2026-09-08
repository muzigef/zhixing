import { z } from "zod/v4";
export const buildProvenanceSchema = z.object({ version: z.literal(1), kind: z.enum(["source_snapshot", "packaged_build"]), codeHash: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40,64}$/).nullable(), dirty: z.boolean().nullable(), capturedAt: z.string().datetime(), node: z.string().max(40), platform: z.string().max(80), files: z.array(z.object({ path: z.string().max(500), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2000) }).strict();
export type BuildProvenance = z.infer<typeof buildProvenanceSchema>;
