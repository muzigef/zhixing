import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { reviewQuality, summarizeQuality } from "../src/quality-review.js";
import type { QualityReport } from "../src/quality-evaluation.js";
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
async function read(selected?: string) {
  if (!selected || !/\.json$/i.test(selected)) throw new Error("evaluation_json_required");
  const resolved = path.resolve(selected);
  if (/(?:^|[/\\])(?:\.env[^/\\]*|auth\.json|\.codex|\.ssh)(?:[/\\]|$)/i.test(resolved)) throw new Error("evaluation_path_denied");
  if ((await fs.lstat(resolved)).isSymbolicLink() || (await fs.stat(resolved)).size > 2_000_000) throw new Error("evaluation_size_limit");
  return JSON.parse(await fs.readFile(resolved, "utf8"));
}
const report = z.object({ version: z.number().int().min(1).max(2), syntheticOnly: z.literal(true), startedAt: z.string().datetime(), results: z.array(z.object({ provider: z.string(), id: z.string(), prompt: z.string(), criteria: z.array(z.string()).min(1), repetition: z.number().int().min(1).max(2), attempted: z.boolean(), status: z.string(), text: z.string(), review: z.enum(["pending_human_review", "unavailable"]), durationMs: z.number().finite().nonnegative().optional(), firstTokenMs: z.number().finite().nonnegative().optional() }).passthrough()).max(48) }).passthrough().parse(await read(arg("report"))) as QualityReport;
const review = arg("reviews") ? reviewQuality(report, await read(arg("reviews"))) : undefined;
const output = arg("output"); const result = { summary: summarizeQuality(report, review), ...(review ? { review } : {}) };
if (output) await fs.writeFile(path.resolve(output), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result.summary, null, 2));
