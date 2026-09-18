import { z } from "zod/v4";
import type { QualityReport } from "./quality-evaluation.js";
const rowSchema = z.object({ provider: z.string().min(1).max(128), id: z.string().min(1).max(64), prompt: z.string().max(128_000), criteria: z.array(z.string().min(1).max(2000)).min(1).max(48), repetition: z.number().int().min(1).max(2), attempted: z.boolean(), status: z.string().max(40), text: z.string().max(100_000), review: z.enum(["pending_human_review", "unavailable"]), durationMs: z.number().finite().nonnegative().optional(), firstTokenMs: z.number().finite().nonnegative().optional(), seed: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(24_000), status: z.enum(["completed", "interrupted"]) }).strict()).max(32).optional() }).passthrough();
const schema = z.object({ version: z.number().int().min(1).max(2), syntheticOnly: z.literal(true), startedAt: z.string().datetime(), datasetHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), expectedResults: z.number().int().nonnegative().max(96).optional(), results: z.array(rowSchema).max(96) }).passthrough();
export function parseQualityReport(raw: unknown): QualityReport {
  const value = schema.parse(raw); const keys = value.results.map(row => JSON.stringify([row.provider, row.id, row.repetition]));
  if (new Set(keys).size !== keys.length || value.expectedResults !== undefined && value.expectedResults < value.results.length) throw new Error("quality_report_results_invalid");
  return value as QualityReport;
}
