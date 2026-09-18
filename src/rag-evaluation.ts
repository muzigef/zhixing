import { qualityRubricHash } from "./explanation-rubric.js";
import { z } from "zod/v4";
import type { SearchResult } from "./contracts.js";
import { citationSchema } from "./learning-contracts.js";
import { sourceHash } from "./source-version.js";
import { retrievalQuestionSchema, scoreRetrieval } from "./retrieval-evaluation.js";
import type { QualityAnswer, QualityReport } from "./quality-evaluation.js";
import { inspectEvidenceSupport } from "./evidence-support.js";
import { citationMarker } from "./citation-marker.js";

const evidenceSchema = z.object({ citation: citationSchema, text: z.string().min(1).max(4000), score: z.number().finite() }).strict();
const caseSchema = retrievalQuestionSchema.omit({ query: true }).extend({ question: z.string().min(1).max(400), oracle: z.array(evidenceSchema).max(3), criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20), expectation: z.enum(["answer", "abstain"]) }).strict();
export type RagCase = z.infer<typeof caseSchema>;
type Retrieval = { status: "completed" | "failed" | "cancelled" | "invalid_evidence" | "not_attempted"; evidence: SearchResult[]; score?: ReturnType<typeof scoreRetrieval>; durationMs?: number };
type Generation = QualityAnswer & { status: "running" | "completed" | "failed" | "cancelled" | "not_attempted"; evidence: SearchResult[]; attempted: boolean; observations?: { abstained: boolean; citationMarkersValid: boolean; evidenceIssueCodes: string[] }; };
export interface RagReport { evaluationDesign?: QualityReport["evaluationDesign"]; version: 1; syntheticOnly: true; startedAt: string; datasetHash: string; provider: string; model: string; planned: number; rows: { task: RagCase; retrieval: Retrieval; fixed: Generation; endToEnd: Generation }[]; }
function validEvidence(topic: string, evidence: SearchResult[]): boolean {
  return evidence.length <= 8 && evidence.every(item => evidenceSchema.safeParse(item).success && item.citation.topicId === topic && item.citation.contentHash === sourceHash(item.text));
}
/** The searcher and generator receive no rubric, oracle label or expected answer. */
export async function evaluateRag(raw: RagCase[], identity: { provider: string; model: string }, search: (input: { topic: string; query: string }) => Promise<SearchResult[]>, generate: (input: { question: string; evidence: SearchResult[] }, signal: AbortSignal) => Promise<QualityAnswer>, signal: AbortSignal, checkpoint?: (report: RagReport) => Promise<void>): Promise<RagReport> {
  const parsed = z.array(caseSchema).min(1).max(12).safeParse(raw);
  if (!parsed.success) throw new Error("rag_dataset_invalid");
  const tasks = parsed.data;
  if (new Set(tasks.map(task => task.id)).size !== tasks.length || tasks.some(task => !validEvidence(task.topic, task.oracle) || (task.expectation === "abstain" ? task.oracle.length || task.relevant.length : !task.relevant.length || scoreRetrieval({ id: task.id, topic: task.topic, query: task.question, relevant: task.relevant }, task.oracle).recall !== 1))) throw new Error("rag_dataset_invalid");
  z.object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(128) }).strict().parse(identity);
  const report: RagReport = { version: 1, syntheticOnly: true, startedAt: new Date().toISOString(), datasetHash: sourceHash(JSON.stringify(tasks.map(task => ({ ...task, oracle: task.oracle.map(({ text, citation }) => ({ text, citation: { topicId: citation.topicId, documentName: citation.documentName, pageNumber: citation.pageNumber, anchor: citation.anchor, contentHash: citation.contentHash } })) })))), ...identity, evaluationDesign: { datasetClassification: "development", caseIds: tasks.map(task => task.id), rubricHash: qualityRubricHash(tasks), rubricTiming: "before_dispatch" }, planned: tasks.length, rows: [] };
  const empty = (): Generation => ({ status: "not_attempted", text: "", evidence: [], attempted: false });
  async function generation(task: RagCase, evidence: SearchResult[]): Promise<Generation> {
    const selected = structuredClone(evidence.slice(0, 3));
    if (signal.aborted) return { ...empty(), status: "cancelled", evidence: selected };
    const start = performance.now();
    try {
      const answer = await generate({ question: task.question, evidence: structuredClone(selected) }, signal); signal.throwIfAborted();
      if (answer.status !== "completed" || !answer.text.trim() || answer.text.length > 64_000) throw new Error("rag_generation_incomplete");
      const markers = answer.text.match(/\[[^\]\n]+#(?:page|anchor)=[^\]\n]+\]/g) ?? [];
      return { ...answer, error: undefined, status: "completed", attempted: true, evidence: selected, durationMs: performance.now() - start, observations: { abstained: /insufficient_evidence/.test(answer.text), citationMarkersValid: markers.length > 0 && markers.every(marker => selected.some(item => citationMarker(item.citation) === marker)), evidenceIssueCodes: inspectEvidenceSupport(answer.text, selected).issues.map(issue => issue.code) } };
    } catch { return { ...empty(), status: signal.aborted ? "cancelled" : "failed", error: signal.aborted ? "cancelled" : "rag_generation_failed", attempted: true, evidence: selected, durationMs: performance.now() - start }; }
  }
  for (const task of tasks) {
    const row: RagReport["rows"][number] = { task, retrieval: { status: "not_attempted", evidence: [] }, fixed: empty(), endToEnd: empty() }; report.rows.push(row); await checkpoint?.(report);
    const start = performance.now();
    if (signal.aborted) row.retrieval.status = "cancelled";
    else try {
      const evidence = structuredClone(await search({ topic: task.topic, query: task.question })); signal.throwIfAborted();
      row.retrieval = validEvidence(task.topic, evidence) ? { status: "completed", evidence, score: scoreRetrieval({ id: task.id, topic: task.topic, query: task.question, relevant: task.relevant }, evidence), durationMs: performance.now() - start } : { status: "invalid_evidence", evidence: [], durationMs: performance.now() - start };
    } catch { row.retrieval = { status: signal.aborted ? "cancelled" : "failed", evidence: [], durationMs: performance.now() - start }; }
    await checkpoint?.(report);
    if (!signal.aborted) { row.fixed = { ...empty(), status: "running", attempted: true, evidence: structuredClone(task.oracle.slice(0, 3)) }; await checkpoint?.(report); }
    row.fixed = await generation(task, task.oracle); await checkpoint?.(report);
    if (row.retrieval.status === "completed") {
      if (!signal.aborted) { row.endToEnd = { ...empty(), status: "running", attempted: true, evidence: structuredClone(row.retrieval.evidence.slice(0, 3)) }; await checkpoint?.(report); }
      row.endToEnd = await generation(task, row.retrieval.evidence);
    }
    else if (signal.aborted) row.endToEnd.status = "cancelled";
    await checkpoint?.(report);
  }
  return report;
}
export function summarizeRag(report: RagReport) {
  const recalls = report.rows.flatMap(row => row.retrieval.status === "completed" && row.retrieval.score?.recall !== null && row.retrieval.score?.recall !== undefined ? [row.retrieval.score.recall] : []);
  return { planned: report.planned, recorded: report.rows.length, completedRetrieval: report.rows.filter(row => row.retrieval.status === "completed").length, retrievalRecall: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null,
    fixedCompleted: report.rows.filter(row => row.fixed.status === "completed").length, endToEndCompleted: report.rows.filter(row => row.endToEnd.status === "completed").length,
    reviewed: 0, answerQuality: "pending_review", interpretation: "检索覆盖、固定正确来源生成和真实检索后生成分开记录；完成、有效引用与规则未发现问题不等于答案正确。按同题两阶段对照复核，缺失或失败不能算通过。" };
}
/** Existing source-hash-bound review CLI can grade both phases independently. */
export function ragQualityReport(report: RagReport, conditions?: QualityReport["conditions"]): QualityReport {
  return { version: 2, syntheticOnly: true, conditions, evaluationDesign: report.evaluationDesign, startedAt: report.startedAt, datasetHash: report.datasetHash, expectedResults: report.planned * 2,
    results: report.rows.flatMap(row => (["fixed", "endToEnd"] as const).map(phase => ({ ...row[phase], id: row.task.id, prompt: row.task.question, criteria: row.task.criteria, provider: `${phase === "fixed" ? "fixed" : "end_to_end"}:${report.provider}`, model: report.model, repetition: 1, attempted: row[phase].attempted, review: row[phase].status === "completed" ? "pending_human_review" as const : "unavailable" as const, ragEvidence: { phase, evidence: row[phase].evidence, retrieval: row.retrieval } }))) };
}
