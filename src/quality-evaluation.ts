import type { BuildProvenance } from "./build-provenance-contracts.js";
import { createHash } from "node:crypto";
import { publicError } from "./agent-errors.js";
export interface QualityCase { id: string; prompt: string; criteria: string[]; seed?: { role: "user" | "assistant"; text: string; status: "completed" | "interrupted" }[]; }
export interface QualityAnswer { status: string; text: string; error?: string; durationMs?: number; firstTokenMs?: number; model?: string; items?: unknown[]; usage?: unknown; reasoning?: string; timings?: { turns: number; toolCalls: number; [key: string]: unknown }; quality?: unknown; evidenceSupport?: unknown; modelTimings?: unknown; }
/** Classify only known evidence; an empty final text does not identify a provider outage. */
export function qualityFailure(answer: QualityAnswer): string {
  if (answer.status === "interrupted") return "cancelled";
  if (answer.status === "blocked") return "execution_blocked";
  if (answer.status !== "failed") return "incomplete";
  // Legacy reports contain the service's safe public message rather than an internal code.
  if (answer.error === "repeated_tool_call" || answer.error === publicError(new Error("repeated_tool_call"))) return "execution_no_progress";
  if (answer.error === "empty_answer") return "empty_answer";
  if (answer.error === "provider_failure") return "provider_failure";
  if (answer.error === "evaluation_exception") return "evaluation_failure";
  return "unclassified_failure";
}
export function qualitySeed(id: string): { role: "user" | "assistant"; text: string; status: "completed" | "interrupted" }[] {
  const pair = (user: string, assistant: string, status: "completed" | "interrupted" = "completed") => [{ role: "user" as const, text: user, status: "completed" as const }, { role: "assistant" as const, text: assistant, status }];
  if (id === "R03") return pair("解释缓存的好处与更新代价，举网页例子。", "缓存能减少重复工作、降低延迟，但更新后可能读到过期结果，需要失效策略。网页缓存是一个例子。");
  if (id === "R08") return pair("解释 RAG 检索、重排、生成三个步骤。", "检索先从资料中找到候选片段。接下来要解释重排和生成。", "interrupted");
  if (id === "R11") return pair("计算 f(x)=x² 在 x=3 的导数。", "错误示例：导数是 x，所以在 x=3 时等于 3。");
  if (["R04", "R05", "R07"].includes(id)) return pair("当前讨论已导入的 retrieval.md 中 RAG 缓存的适用范围。", "我会依据这份材料回答，并明确资料没有覆盖的问题。");
  if (id === "R10") return pair("我们比较 RAG 与微调。", "可以从知识更新、证据可追溯和行为适配三个维度比较。");
  return [];
}

/** Completion and format checks are observations; correctness still requires review. */
export async function evaluateQuality(cases: QualityCase[], providers: string[], repetitions: number,
  run: (provider: string, task: QualityCase, repetition: number) => Promise<QualityAnswer>,
  checkpoint?: (report: QualityReport) => Promise<void>): Promise<QualityReport> {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 2 || !cases.length || cases.length > 12 || !providers.length || providers.length > 2 || new Set(cases.map(task => task.id)).size !== cases.length || new Set(providers).size !== providers.length) throw new Error("evaluation_budget_invalid");
  const report: QualityReport = { version: 2, syntheticOnly: true, startedAt: new Date().toISOString(), datasetHash: createHash("sha256").update(JSON.stringify(cases)).digest("hex"), expectedResults: cases.length * providers.length * repetitions, results: [] };
  for (const provider of providers) {
    let unavailable: QualityAnswer | undefined;
    for (let repetition = 1; repetition <= repetitions; repetition++) for (const task of cases) {
      const attempted = !unavailable;
      let answer: QualityAnswer;
      if (unavailable) answer = { status: "failed", text: "", error: "evaluation_not_attempted", model: unavailable.model, reasoning: unavailable.reasoning };
      else { try { answer = await run(provider, task, repetition); } catch { answer = { status: "failed", text: "", error: "evaluation_exception" }; } }
      if (answer.status === "completed" && !answer.text.trim()) answer = { ...answer, status: "failed", error: "empty_answer" };
      if (!answer.text && answer.status === "failed" && !["execution_no_progress", "empty_answer"].includes(qualityFailure(answer))) unavailable = answer;
      report.results.push({ provider, repetition, ...task, ...answer, attempted, review: ["completed", "waiting"].includes(answer.status) ? "pending_human_review" : "unavailable" });
      await checkpoint?.(report);
    }
  }
  return report;
}
export interface QualityReport { version: number; syntheticOnly: boolean; startedAt: string; datasetHash?: string; expectedResults?: number; conditions?: { provenance?: BuildProvenance; dataset: string; codeHash: string; requestedReasoning: string }; results: (QualityCase & QualityAnswer & { provider: string; repetition: number; attempted: boolean; review: "pending_human_review" | "unavailable" })[]; }
