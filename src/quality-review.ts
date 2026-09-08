import { createHash } from "node:crypto";
import { z } from "zod";
import type { QualityReport } from "./quality-evaluation.js";

export function qualityReportHash(report: QualityReport): string {
  const canonical = JSON.stringify(report, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash("sha256").update(canonical).digest("hex");
}
const verdictSchema = z.enum(["pass", "partial", "fail"]);
const scoreSchema = z.object({ provider: z.string().min(1).max(128), id: z.string().min(1).max(64), repetition: z.number().int().min(1).max(2), criteria: z.array(verdictSchema).min(1).max(20), rationale: z.string().trim().min(1).max(4000), failures: z.array(z.enum(["accuracy", "grounding", "format", "repetition", "unnecessary_question", "execution", "other"])).max(7) }).strict();
export const qualityReviewSchema = z.object({ version: z.literal(1), reportHash: z.string().regex(/^[a-f0-9]{64}$/), reviewer: z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(["human", "development_assistant"]), independent: z.boolean() }).strict().refine(r => r.kind === "human" || !r.independent), scores: z.array(scoreSchema).max(48) }).strict();
export function reviewQuality(report: QualityReport, raw: unknown) {
  const review = qualityReviewSchema.parse(raw);
  if (review.reportHash !== qualityReportHash(report)) throw new Error("review_report_mismatch");
  const seen = new Set<string>();
  const scores = review.scores.map(score => {
    const key = JSON.stringify([score.provider, score.id, score.repetition]); if (seen.has(key)) throw new Error("review_duplicate"); seen.add(key);
    const row = report.results.find(row => row.provider === score.provider && row.id === score.id && row.repetition === score.repetition);
    if (!row?.attempted || !["completed", "waiting"].includes(row.status) || score.criteria.length !== row.criteria.length) throw new Error("review_result_invalid");
    return { ...score, verdict: score.criteria.includes("fail") ? "fail" as const : score.criteria.includes("partial") ? "partial" as const : "pass" as const };
  });
  return { ...review, scores };
}
export type QualityReview = ReturnType<typeof reviewQuality>;
function quantiles(values: number[]) { const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b); return { samples: sorted.length, p50: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1]! : null, p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : null }; }
export function summarizeQuality(report: QualityReport, supplied?: QualityReview) {
  // Revalidate provenance even if a caller constructed an apparent typed review.
  const review = supplied ? reviewQuality(report, { ...supplied, scores: supplied.scores.map(score => scoreSchema.strip().parse(score)) }) : undefined;
  const failures: Record<string, number> = {}; const fail = (code: string) => { failures[code] = (failures[code] ?? 0) + 1; };
  const groups = new Map<string, { provider: string; model: string; reasoning: string; planned: number; attempted: number; completed: number; waiting: number; durations: number[]; firstTokens: number[] }>();
  for (const row of report.results) {
    const key = JSON.stringify([row.provider, row.model ?? "unknown", row.reasoning ?? "unknown"]);
    const group = groups.get(key) ?? { provider: row.provider, model: row.model ?? "unknown", reasoning: row.reasoning ?? "unknown", planned: 0, attempted: 0, completed: 0, waiting: 0, durations: [], firstTokens: [] };
    group.planned++;
    if (!row.attempted) fail("not_attempted");
    else {
      group.attempted++;
      if (row.status === "completed") group.completed++;
      else if (row.status === "waiting") { group.waiting++; fail("waiting"); }
      else fail(row.status === "failed" && !row.text ? "provider_failure" : row.status === "interrupted" ? "cancelled" : row.status === "blocked" ? "execution_blocked" : "incomplete");
      // Latency describes completed answers only; failures are counted separately above.
      if (row.status === "completed") { if (row.durationMs !== undefined) group.durations.push(row.durationMs); if (row.firstTokenMs !== undefined) group.firstTokens.push(row.firstTokenMs); }
    }
    groups.set(key, group);
  }
  const reviewed = review?.scores.length ?? 0; const passed = review?.scores.filter(score => score.verdict === "pass").length ?? 0;
  const reviewable = report.results.filter(row => row.attempted && ["completed", "waiting"].includes(row.status)).length;
  const qualityFailures: Record<string, number> = {}; for (const score of review?.scores ?? []) for (const failure of new Set(score.failures)) qualityFailures[failure] = (qualityFailures[failure] ?? 0) + 1;
  return { version: 1, reportHash: qualityReportHash(report), datasetHash: report.datasetHash ?? null, planned: report.expectedResults ?? report.results.length, recorded: report.results.length, attempted: report.results.filter(row => row.attempted).length, completed: report.results.filter(row => row.attempted && row.status === "completed").length,
    reviewed, unreviewed: reviewable - reviewed, passed, passRate: reviewed ? passed / reviewed : null, independentHumanReviewed: review?.reviewer.kind === "human" && review.reviewer.independent ? reviewed : 0, reviewer: review?.reviewer ?? null, failures, qualityFailures,
    groups: [...groups.values()].map(({ durations, firstTokens, ...group }) => ({ ...group, latency: quantiles(durations), firstToken: quantiles(firstTokens) })),
    interpretation: "描述性统计。通过率分母为已评分结果；未评分、未尝试和未完成不能算通过。耗时采用完成回答的最近秩 P50/P95；模型、思考档位、数据集和代码条件不同不能直接合并。评分者身份与独立性由导入者声明，应用不验证其身份。",
  };
}
