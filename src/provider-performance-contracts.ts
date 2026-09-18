import { z } from "zod/v4";
export const providerBenchmarkSelectionSchema = z.object({ cycles: z.number().int().min(1).max(3).default(2) }).strict();
