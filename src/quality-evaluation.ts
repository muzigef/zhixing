export interface QualityCase { id: string; prompt: string; criteria: string[]; }
export interface QualityAnswer { status: string; text: string; error?: string; durationMs?: number; firstTokenMs?: number; model?: string; items?: unknown[]; usage?: unknown; reasoning?: string; }
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
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 2 || cases.length > 12 || providers.length > 2) throw new Error("evaluation_budget_invalid");
  const report: QualityReport = { version: 1, syntheticOnly: true, startedAt: new Date().toISOString(), results: [] };
  for (const provider of providers) {
    let unavailable: QualityAnswer | undefined;
    for (let repetition = 1; repetition <= repetitions; repetition++) for (const task of cases) {
      const attempted = !unavailable;
      const answer = unavailable ?? await run(provider, task, repetition);
      if (!answer.text && answer.status === "failed") unavailable = answer;
      report.results.push({ provider, repetition, ...task, ...answer, attempted, review: ["completed", "waiting"].includes(answer.status) ? "pending_human_review" : "unavailable" });
      await checkpoint?.(report);
    }
  }
  return report;
}
export interface QualityReport { version: number; syntheticOnly: boolean; startedAt: string; results: (QualityCase & QualityAnswer & { provider: string; repetition: number; attempted: boolean; review: "pending_human_review" | "unavailable" })[]; }
