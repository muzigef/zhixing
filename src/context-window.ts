import { imageBudgetView } from "./image-input.js";
import type { ModelMessage, ModelToolDefinition, ModelTurn } from "./model.js";

export interface ContextBudget { windowTokens: number; reserveOutputTokens: number; }
export interface ContextUsage { estimatedInputTokens: number; reservedOutputTokens: number; windowTokens: number; chars: number; omittedMessages: number; omittedTurns: number; estimateMultiplier?: number; reportedInputTokens?: number; }
/** Provider-independent planning estimate, not a tokenizer or billing measurement. */
export function estimateTokens(text: string): number {
  let units = 0;
  for (const character of text) units += character.codePointAt(0)! < 128 ? 1 / 3 : 2;
  return Math.ceil(units);
}

/** Select a disposable model view. Durable messages, tool pairs and decisions are never rewritten. */
export function modelContextWindow(input: { prompt: string; messages?: readonly ModelMessage[]; history: readonly ModelTurn[]; tools?: readonly ModelToolDefinition[]; pending?: ModelTurn }, maxChars: number, budget: ContextBudget = { windowTokens: 48_000, reserveOutputTokens: 16_384 }, estimateMultiplier = 1) {
  if (!Number.isFinite(estimateMultiplier) || estimateMultiplier < 1 || estimateMultiplier > 4) throw new Error("context_budget_invalid");
  if (![budget.windowTokens, budget.reserveOutputTokens].every(value => Number.isSafeInteger(value) && value > 0) || budget.reserveOutputTokens >= budget.windowTokens) throw new Error("context_budget_invalid");
  const base = input.messages?.length ? input.messages : [{ role: "user" as const, content: input.prompt }];
  const firstUser = base.findIndex(message => message.role === "user");
  const lastUser = base.findLastIndex(message => message.role === "user");
  const lastAssistant = base.findLastIndex(message => message.role === "assistant");
  const messages = base.map((message, index) => ({ message, index }));
  const history = [...input.history]; let omittedMessages = 0; let omittedTurns = 0;
  const feedback: string[] = [];
  const project = () => {
    const selected = messages.map(item => item.message);
    if (omittedMessages || omittedTurns) selected.splice(Math.max(0, selected.length - 1), 0, { role: "observation", content: JSON.stringify({ omittedMessages, omittedTurns, notice: "较早记录已从本次模型上下文移除，原文仍保存在本地。缺少的事实不可猜测；可查询实际任务状态或说明缺失。", ...(feedback.length ? { priorUserFeedback: feedback } : {}) }) });
    const serialized = imageBudgetView({ messages: selected, history, tools: input.tools ?? [], ...(input.pending ? { pending: input.pending } : {}) });
    return { messages: selected, usage: { estimatedInputTokens: Math.ceil((estimateTokens(serialized.text) + serialized.imageTokens) * estimateMultiplier), reservedOutputTokens: budget.reserveOutputTokens, windowTokens: budget.windowTokens, chars: serialized.text.length, omittedMessages, omittedTurns, estimateMultiplier } };
  };
  for (;;) {
    const view = project();
    if (view.usage.chars <= maxChars && view.usage.estimatedInputTokens + budget.reserveOutputTokens <= budget.windowTokens) {
      return { ...view, history, prompt: omittedMessages || omittedTurns ? view.messages.map(message => `${message.role}: ${message.content}`).join("\n\n") : input.prompt };
    }
    // Whole completed turns only. The latest result and every pending call remain available.
    if (history.length > 1) {
      const removed = history.shift()!; omittedTurns++;
      if (removed.feedback) { feedback.push(removed.feedback.slice(-4000)); if (feedback.length > 4) feedback.shift(); }
      continue;
    }
    const removable = messages.findIndex(({ message, index }) => message.role !== "system" && message.role !== "observation" && ![firstUser, lastUser, lastAssistant].includes(index));
    if (removable < 0) throw new Error("model_input_limit");
    messages.splice(removable, 1); omittedMessages++;
  }
}
