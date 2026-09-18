import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { SearchResult } from "./contracts.js";
import { topicIdSchema } from "./contracts.js";

const referenceSchema = z.object({ document: z.string().min(1).max(255), anchor: z.string().min(1).max(1000), grade: z.union([z.literal(1), z.literal(2)]) }).strict();
export const retrievalQuestionSchema = z.object({ id: z.string().min(1).max(80), topic: topicIdSchema, query: z.string().min(1).max(400), relevant: z.array(referenceSchema).max(24).refine(refs => new Set(refs.map(ref => JSON.stringify([ref.document, ref.anchor]))).size === refs.length) }).strict();
export type RetrievalQuestion = z.infer<typeof retrievalQuestionSchema>;
export type RetrievalArm = "lexical" | "semantic" | "hybrid";
type Attempt = { status: "completed" | "fallback"; actualMode: string; evidence: SearchResult[]; modelIdentity: string | null } | { status: "unavailable"; reason: string };
export function scoreRetrieval(raw: RetrievalQuestion, evidence: readonly SearchResult[], k = 3) {
  const task = retrievalQuestionSchema.parse(raw); z.number().int().min(1).max(8).parse(k);
  const selected = evidence.slice(0, k), seen = new Set<number>(); let dcg = 0, reciprocalRank = 0;
  selected.forEach((item, rank) => {
    const index = item.citation.topicId === task.topic ? task.relevant.findIndex(ref => item.citation.documentName === ref.document && item.citation.anchor === ref.anchor) : -1;
    if (index < 0 || seen.has(index)) return;
    seen.add(index); reciprocalRank ||= 1 / (rank + 1);
    dcg += (2 ** task.relevant[index]!.grade - 1) / Math.log2(rank + 2);
  });
  const ideal = task.relevant.map(ref => ref.grade).sort((a, b) => b - a).slice(0, k).reduce((sum, grade, rank) => sum + (2 ** grade - 1) / Math.log2(rank + 2), 0);
  return { k, relevantRetrieved: seen.size, recall: task.relevant.length ? seen.size / task.relevant.length : null, precision: task.relevant.length ? seen.size / k : null,
    reciprocalRank: task.relevant.length ? reciprocalRank : null, ndcg: ideal ? dcg / ideal : null,
    falsePositive: task.relevant.length ? null : selected.length > 0, scopeViolation: evidence.some(item => item.citation.topicId !== task.topic) };
}
export interface RetrievalRow {
  arm: RetrievalArm; question: RetrievalQuestion; status: "completed" | "fallback" | "unavailable" | "failed" | "cancelled";
  actualMode?: string; modelIdentity?: string | null; evidence?: SearchResult[]; durationMs?: number; reason?: string;
  score?: ReturnType<typeof scoreRetrieval>;
}
export interface RetrievalReport { version: 1; questionHash: string; k: number; planned: number; rows: RetrievalRow[]; }
export async function evaluateRetrieval(raw: RetrievalQuestion[], arms: RetrievalArm[], search: (arm: RetrievalArm, task: RetrievalQuestion) => Promise<Attempt>, signal: AbortSignal, k = 3, checkpoint?: (report: RetrievalReport) => Promise<void>): Promise<RetrievalReport> {
  const questions = z.array(retrievalQuestionSchema).min(1).max(100).parse(raw);
  z.array(z.enum(["lexical", "semantic", "hybrid"])).min(1).max(3).parse(arms);
  z.number().int().min(1).max(8).parse(k);
  if (new Set(questions.map(q => q.id)).size !== questions.length || new Set(arms).size !== arms.length) throw new Error("retrieval_evaluation_duplicate");
  const report: RetrievalReport = { version: 1, questionHash: createHash("sha256").update(JSON.stringify(questions)).digest("hex"), k, planned: questions.length * arms.length, rows: [] };
  for (const arm of arms) for (const question of questions) {
    const row: RetrievalRow = { arm, question, status: "cancelled" }; const start = performance.now();
    if (!signal.aborted) try {
      const attempt = await search(arm, question); signal.throwIfAborted();
      Object.assign(row, attempt, { durationMs: performance.now() - start });
      if (attempt.status === "completed") row.score = scoreRetrieval(question, attempt.evidence, k);
    } catch (error) { row.status = signal.aborted ? "cancelled" : "failed"; row.reason = error instanceof Error && /^semantic_[a-z_]+$/.test(error.message) ? error.message : "retrieval_evaluation_failed"; }
    report.rows.push(row); await checkpoint?.(report);
  }
  return report;
}
export function summarizeRetrieval(report: RetrievalReport) {
  const mean = (values: (number | null)[]) => { const present = values.filter((v): v is number => v !== null); return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null; };
  const groups = [...new Set(report.rows.map(row => row.arm))].map(arm => {
    const rows = report.rows.filter(row => row.arm === arm);
    const scores = rows.filter(row => row.status === "completed").map(row => scoreRetrieval(row.question, row.evidence ?? [], report.k));
    const negatives = scores.filter(score => score.falsePositive !== null);
    return { arm, planned: rows.length, completed: scores.length, fallback: rows.filter(row => row.status === "fallback").length, unavailable: rows.filter(row => row.status === "unavailable").length, failed: rows.filter(row => row.status === "failed").length, cancelled: rows.filter(row => row.status === "cancelled").length,
      meanRecall: mean(scores.map(score => score.recall)), meanPrecision: mean(scores.map(score => score.precision)), mrr: mean(scores.map(score => score.reciprocalRank)), meanNdcg: mean(scores.map(score => score.ndcg)), negativeQueries: negatives.length, falsePositiveRate: negatives.length ? negatives.filter(score => score.falsePositive).length / negatives.length : null, scopeViolations: scores.filter(score => score.scopeViolation).length };
  });
  return { planned: report.planned, recorded: report.rows.length, k: report.k, groups, interpretation: "按已完成查询计算宏平均；重复来源只计首次命中，Precision@k 分母固定 k。无相关资料的查询单列误召回率；不可用、失败、取消和词法回退不算语义/混合成功。来源标注用于检索评测，不证明生成答案正确。" };
}
