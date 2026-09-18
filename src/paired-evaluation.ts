import { z } from "zod/v4";
import { sourceHash } from "./source-version.js";
const rowSchema = z.object({ caseId: z.string().min(1).max(100), repeat: z.number().int().min(1).max(100), arm: z.string().min(1).max(100), score: z.number().finite().min(0).max(1), completed: z.boolean() }).strict();
export type PairedObservation = z.infer<typeof rowSchema>;
/** Pair first, average repeats within each case, then resample case clusters. */
export function pairedEvaluation(input: readonly PairedObservation[], baseline: string, candidate: string) {
  const rows = z.array(rowSchema).max(10_000).parse(input);
  if (!baseline || !candidate || baseline === candidate) throw new Error("paired_evaluation_arms");
  const selected = rows.filter(row => row.arm === baseline || row.arm === candidate), indexed = new Map<string, PairedObservation>();
  for (const row of selected) { const key = JSON.stringify([row.caseId, row.repeat, row.arm]); if (indexed.has(key)) throw new Error("paired_evaluation_duplicate"); indexed.set(key, row); }
  const clusters = new Map<string, number[]>(); let pairs = 0;
  for (const row of selected.filter(row => row.arm === candidate)) {
    const base = indexed.get(JSON.stringify([row.caseId, row.repeat, baseline])); if (!base) continue;
    pairs++; const values = clusters.get(row.caseId) ?? [];
    values.push((row.completed ? row.score : 0) - (base.completed ? base.score : 0)); clusters.set(row.caseId, values);
  }
  if (clusters.size > 100) throw new Error("paired_evaluation_case_limit");
  const cases = [...clusters].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([caseId, deltas]) => ({ caseId, pairs: deltas.length, delta: deltas.sort((a, b) => a - b).reduce((a, b) => a + b, 0) / deltas.length }));
  const wins = cases.filter(item => item.delta > 1e-12).length, losses = cases.filter(item => item.delta < -1e-12).length;
  const n = wins + losses;
  let term = n ? 2 ** -n : 0, sum = term;
  for (let k = 1; k <= Math.min(wins, losses); k++) { term *= (n - k + 1) / k; sum += term; }
  let confidenceInterval95: [number, number] | null = null;
  const resamples = cases.length >= 2 ? 2000 : 0;
  if (resamples) {
    let state = Number.parseInt(sourceHash(JSON.stringify(cases)).slice(0, 8), 16) || 1;
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2 ** 32; };
    const samples = Array.from({ length: resamples }, () => { let total = 0; for (let i = 0; i < cases.length; i++) total += cases[Math.floor(random() * cases.length)]!.delta; return total / cases.length; }).sort((a, b) => a - b);
    confidenceInterval95 = [samples[Math.ceil(resamples * .025) - 1]!, samples[Math.ceil(resamples * .975) - 1]!];
  }
  return { against: baseline, arm: candidate, metric: "delivered_field_score_with_incomplete_zero", pairs, unpairedRows: selected.length - pairs * 2, caseClusters: cases.length, cases, meanDelta: cases.length ? cases.reduce((sum, item) => sum + item.delta, 0) / cases.length : null,
    wins, ties: cases.length - wins - losses, losses, confidenceInterval95, resamples, signTest: { nonTiedCases: n, twoSidedP: n ? Math.min(1, 2 * sum) : null, multiplicity: "unadjusted_exploratory" },
    interpretation: "先匹配同题同次，再按题平均；同题重复不增加题数。区间为固定开发题的按题重采样，符号检验未校正多重比较；不证明题目独立、总体改善或教学因果效果。缺失配对单列，未完成交付计零。" };
}
