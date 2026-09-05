import type { Citation } from "./contracts.js";
import { citationSchema } from "./learning-contracts.js";
import type { LearningApplication } from "./learning-application.js";
import { isContinuableModelClient, type ModelClient } from "./model.js";
import { collectInvocation } from "./model-invocation.js";
import type { ModelAuditRecord } from "./model-audit.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { WorkflowLedger } from "./workflow-ledger.js";

export interface TaskActivity { label: string; status: "running" | "completed" | "failed"; at: string; }
export function providerRuntime(providerId: string, client: ModelClient): ProviderRuntime {
  const registry = new ProviderRegistry();
  registry.register({ id: providerId, client, health: async () => "unknown" });
  registry.route("tutor", providerId);
  return new ProviderRuntime(registry, client);
}

/** Shared model/tool loop with concrete activity events and topic-scoped evidence. */
export async function runAssistantTask(options: {
  runId: string; providerId: string; client: ModelClient; prompt: string; question: string;
  application?: LearningApplication; topicId?: string; contextAllowed: boolean;
  onText: (text: string) => void;
  onActivity: (activity: TaskActivity, key: string) => void;
  onCitation: (citation: Citation) => void;
}, signal: AbortSignal) {
  const started = Date.now();
  const ledger = options.application ? new WorkflowLedger(options.application.database) : undefined;
  ledger?.begin(options.runId, options.topicId ?? "general-chat", "assistant_task", options.question);
  const activity = (key: string, label: string, status: TaskActivity["status"]) => {
    ledger?.step(options.runId, key, status === "running" ? "started" : status === "completed" ? "finished" : "failed");
    options.onActivity({ label, status, at: new Date().toISOString() }, key);
  };
  let prompt = options.prompt;
  let contextMs = 0;
  let trace: ModelAuditRecord | undefined;
  let toolSequence = 0;
  const tools = options.application && options.topicId && options.contextAllowed && isContinuableModelClient(options.client) ? options.application.tools(true) : undefined;
  try {
    if (options.application && options.topicId) {
      activity("context", options.contextAllowed ? "读取学习进度并检索当前主题资料" : "检查本会话的学习上下文授权", "running");
      const context = await options.application.context(options.topicId, options.question, options.contextAllowed, signal);
      signal.throwIfAborted();
      prompt += `\n\n${context.text}`;
      for (const evidence of context.evidence) options.onCitation(evidence.citation);
      activity("context", options.contextAllowed ? "已读取学习进度与资料依据" : "仅使用本轮对话内容", "completed");
    }
    contextMs = Date.now() - started;
    activity("answer", "组织回答", "running");
    const result = await collectInvocation(providerRuntime(options.providerId, options.client), {
      role: "tutor", providerId: options.providerId, prompt,
      containsUserMaterials: true, confirmed: true, allowFallback: false, requireDone: true,
      tools: tools?.definitions,
      onText: options.onText,
      onAudit: (value) => { trace = value; },
      onToolCall: tools && options.topicId ? async (name, input, toolSignal) => {
        const labels: Record<string, string> = { learning_progress: "查看学习进度", list_materials: "查看资料目录", search_materials: "检索资料" };
        const key = `tool-${++toolSequence}`;
        activity(key, labels[name] ?? "执行学习查询", "running");
        const result = await tools.harness.execute(name, input, { topicId: options.topicId!, signal: toolSignal, maxRisk: "read" });
        if (name === "search_materials" && result.ok && Array.isArray(result.output)) {
          for (const value of result.output) {
            const parsed = citationSchema.safeParse((value as { citation?: unknown }).citation);
            if (parsed.success && parsed.data.topicId === options.topicId) options.onCitation(parsed.data);
          }
        }
        activity(key, labels[name] ?? "执行学习查询", result.ok ? "completed" : "failed");
        return result;
      } : undefined,
    }, signal);
    if (result.partial || !result.text.trim()) throw new Error(result.stopReason ?? "provider_incomplete");
    activity("answer", "回答已完成", "completed");
    ledger?.finish(options.runId, "completed");
    return { contextMs, modelMs: Date.now() - started - contextMs, turns: trace?.turns ?? 0, toolCalls: trace?.toolCalls ?? 0 };
  } catch (error) {
    activity("answer", signal.aborted ? "任务已停止" : "本轮未完成", "failed");
    ledger?.finish(options.runId, signal.aborted ? "cancelled" : "failed", signal.aborted ? "cancelled" : "assistant_failed");
    throw error;
  }
}
