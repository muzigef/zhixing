import { sourceHash } from "./source-version.js";
import { z } from "zod/v4";
export const explanationRubric = {
  version: "explanation-v1",
  scale: { 0: "缺失或无法使用", 1: "核心错误/严重缺项/难以理解", 2: "部分成立但有实质问题", 3: "满足主要要求，只有轻微不足", 4: "准确、充分且可核对" },
  dimensions: {
    correctness: "核对事实、计算、推导和适用条件；结论碰巧正确但理由错误不能高分。",
    completeness: "按本阶段任务逐项核对关键步骤、必要条件、边界和不确定性；不奖励无关篇幅。",
    clarity: "面向题目指定读者，定义必要概念，说明步骤衔接与符号含义；流畅不抵消事实错误。",
  },
  decision: "所有维度至少3分且逐项标准全通过才通过；任一维度0或1分失败；其余为部分满足。三项分别汇总，不用平均值掩盖正确性不足。",
} as const;
const dimension = z.object({ score: z.number().int().min(0).max(4), rationale: z.string().trim().min(1).max(2000), quotes: z.array(z.string().trim().min(1).max(500)).min(1).max(4) }).strict();
export const explanationDimensionsSchema = z.object({ correctness: dimension, completeness: dimension, clarity: dimension }).strict();
export const explanationDimensionNames = ["correctness", "completeness", "clarity"] as const;
/** Accept an excerpt from the displayed text or the decoded JSON explanation, never from the oracle. */
export function answerContainsQuote(text: string, quote: string): boolean {
  if (text.includes(quote)) return true;
  try { const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); return typeof value.explanation === "string" && value.explanation.includes(quote); } catch { return false; }
}

/** Bind both the dimension definitions and exact case-specific criteria, without counting repeats as new rubrics. */
export function qualityRubricHash(tasks: readonly { id: string; criteria: string[]; provider?: string }[]): string {
  const entries = [...new Set(tasks.map(task => JSON.stringify([task.id, task.provider ?? "", task.criteria])))].sort();
  return sourceHash(JSON.stringify({ dimensions: explanationRubric, entries }));
}
