import { writePermission, type AgentPermissions, type WriteGrant } from "./agent-permissions.js";
import type { Citation, SearchResult } from "./contracts.js";
import { modelPhaseLabels, type ModelTiming } from "./model-telemetry.js";
import { citationSchema } from "./learning-contracts.js";
import type { LearningApplication } from "./learning-application.js";
import { isContinuableModelClient, type ModelClient, type ModelMessage, type ModelUsage, type ReasoningProfile } from "./model.js";
import { collectInvocation } from "./model-invocation.js";
import type { ModelAuditRecord } from "./model-audit.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { WorkflowLedger } from "./workflow-ledger.js";
import { AgentExecutionStore } from "./agent-execution-store.js";
import { TaskExecutionStore } from "./task-execution.js";
import { verifiedTaskSnapshot } from "./application-tools.js";
import { randomUUID } from "node:crypto";
import { addQuestionTool, interactionId, type AssistantItem, type PendingInteraction } from "./assistant-interactions.js";
import { ToolHarness } from "./tool-harness.js";
import { citationMarker } from "./citation-marker.js";
import { responseRepairReason } from "./response-quality.js";
import type { ContextUsage } from "./context-window.js";
import { attachProjectTools } from "./project-tools.js";
import { lazyMcpTools } from "./lazy-mcp.js";
import { onDemandTools } from "./agent-efficiency.js";
import { inspectEvidenceSupport, evidenceRepairReason, type EvidenceSupport } from "./evidence-support.js";
import { attachExecutionHistory, attachConversationHistory } from "./execution-history.js";
import type { ChatMessage } from "./agent-session-contracts.js";
import { executionEvidence, type ExecutionEvidence } from "./execution-evidence.js";

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
  messages?: readonly ModelMessage[];
  structured?: boolean;
  responseCheck?: (text: string) => string | undefined;
  readOnly?: boolean;
  limits?: Partial<import("./model-invocation.js").InvocationLimits>;
  teaching?: import("./teaching-session-contracts.js").TeachingSession | null;
  onAudit?: (record: ModelAuditRecord) => void | Promise<void>;
  onTool?: (name: string, phase: "started" | "finished" | "failed") => void | Promise<void>;
  onToolReceipt?: (receipt: ExecutionEvidence) => void | Promise<void>;
  conversationHistory?: readonly ChatMessage[];
  permissions?: AgentPermissions; writeGrants?: WriteGrant[];
  taskId?: string; sessionId?: string; resumeInput?: string; steerId?: string; allowWrites?: boolean;
  reasoning?: ReasoningProfile; onUsage?: (usage: ModelUsage) => void;
  onTiming?: (timing: ModelTiming) => void;
  onContext?: (usage: ContextUsage) => void;
  onEvidenceSupport?: (report: EvidenceSupport) => void;
  onItem?: (item: AssistantItem) => void;
  onInteraction?: (item: PendingInteraction) => Promise<void>;
  onTurn?: (text: string, kind: "progress" | "final") => void;
  application?: LearningApplication; topicId?: string; contextAllowed: boolean;
  onText: (text: string) => void;
  onActivity: (activity: TaskActivity, key: string) => void;
  onCitation: (citation: Citation) => void;
  onCandidate?: (citation: Citation) => void;
}, signal: AbortSignal) {
  const started = Date.now();
  const ledger = options.application ? new WorkflowLedger(options.application.database) : undefined;
  ledger?.begin(options.runId, options.topicId ?? "general-chat", "assistant_task", options.question);
  const activity = (key: string, label: string, status: TaskActivity["status"]) => {
    ledger?.step(options.runId, key, status === "running" ? "started" : status === "completed" ? "finished" : "failed");
    options.onActivity({ label, status, at: new Date().toISOString() }, key);
  };
  let prompt = options.prompt;
  const messages = options.messages ? [...options.messages] : undefined;
  let contextMs = 0;
  let trace: ModelAuditRecord | undefined;
  let toolSequence = 0;
  let toolMs = 0;
  const candidates = new Map<string, Citation>();
  const sourceEvidence = new Map<string, SearchResult>();
  const rememberEvidence = (item: SearchResult) => { if (sourceEvidence.size < 24) sourceEvidence.set(JSON.stringify(item.citation), item); };
  const candidate = (citation: Citation) => { const key = JSON.stringify(citation); if (!candidates.has(key) && candidates.size < 24) { candidates.set(key, citation); options.onCandidate?.(citation); } };
  const taskId = options.taskId ?? options.runId;
  const execution = options.application ? new AgentExecutionStore(options.application.database, { taskId, sessionId: options.sessionId ?? taskId, topicId: options.topicId ?? "general-chat" }) : undefined;
  const projectAllowed = options.permissions ? Boolean(options.permissions.projectId) : options.contextAllowed;
  const externalAllowed = options.permissions ? options.permissions.externalRevision !== undefined : options.contextAllowed;
  const anyAccess = options.contextAllowed || projectAllowed || externalAllowed;
  const tasks = options.application && options.topicId && anyAccess && !options.readOnly ? new TaskExecutionStore(options.application.database) : undefined;
  tasks?.begin(taskId, options.topicId!, options.question);
  const retrievalActivity = (status: import("./learning-application.js").RetrievalStatus) => activity("retrieval", status.mode === "lexical_fallback" ? status.reason === "semantic_index_empty" ? "语义索引尚无有效片段，已使用关键词检索" : "语义服务暂不可用，已使用关键词检索" : status.mode === "hybrid" ? "已使用关键词与语义检索" : "已使用关键词与同义词检索", "completed");
  let tools = options.application && options.topicId && anyAccess && isContinuableModelClient(options.client) ? options.application.tools(options.contextAllowed, { learningAccess: options.contextAllowed, taskId, allowWrites: options.allowWrites ?? false, onRetrieval: retrievalActivity }) : undefined;
  let waiting = false;
  const pause = (callId?: string) => {
    waiting = true;
    const checkpoint = execution?.read();
    if (checkpoint?.pending) { checkpoint.pending.phase = "waiting"; checkpoint.status = "waiting"; execution!.save(checkpoint, "interaction_requested", callId); }
  };
  if (!options.readOnly && options.onInteraction && isContinuableModelClient(options.client)) tools = addQuestionTool(tools ?? { harness: new ToolHarness(), definitions: [] }, async (item) => { pause(item.callId); await options.onInteraction!({ ...item, id: interactionId(taskId, item.callId) }); });
  if (tools && execution) tools = attachExecutionHistory(tools, execution, options.contextAllowed, options.permissions);
  if (tools && options.conversationHistory?.length) tools = attachConversationHistory(tools, options.conversationHistory);
  let external: ReturnType<typeof lazyMcpTools> | undefined;
  try {
    if (tools && options.application && options.topicId && anyAccess) {
      if (projectAllowed) tools = attachProjectTools(options.application, tools, options.topicId, taskId);
      if (externalAllowed) { external = lazyMcpTools(tools, options.application.database, options.topicId, signal); tools = external.tools; }
    }
    if (tools && options.readOnly) {
      const harness = tools.harness;
      harness.restrict(name => harness.risk(name) === "read" && !["ask_user", "plan_task"].includes(name));
      tools = { ...tools, definitions: harness.definitions() };
    }
    const restored = execution?.read();
    const restoredCalls = [...(restored?.history ?? []).flatMap(turn => turn.events), ...(restored?.pending?.events ?? [])];
    if (external && restoredCalls.some(event => event.type === "tool_call" && (event.tool?.startsWith("mcp_") || event.tool === "discover_tools" && (event.input as { category?: string })?.category === "external"))) await external.load(signal);
    const catalog = tools ? onDemandTools(tools, restoredCalls, Boolean(tasks?.snapshot(taskId, options.topicId!).plan.length), external?.enabled ? { categories: ["external"], prepare: (_category, signal) => external!.load(signal) } : undefined) : undefined;
    tools = catalog ?? tools;
    if (options.application && options.topicId) {
      activity("context", options.contextAllowed ? "读取学习进度并检索当前主题资料" : "检查本会话的学习上下文授权", "running");
      const context = await options.application.context(options.topicId, options.question, options.contextAllowed, signal, options.teaching);
      if (context.retrieval?.mode === "lexical_fallback") retrievalActivity(context.retrieval);
      signal.throwIfAborted();
      prompt += `\n\n${context.text}`;
      // Application observations stay below trusted instructions and before the current request.
      if (context.text) messages?.splice(Math.max(0, messages.length - 1), 0, { role: "observation", content: context.text });
      const snapshot = tasks?.snapshot(taskId, options.topicId!);
      if (snapshot && (snapshot.plan.length || snapshot.operations.length || snapshot.revision)) {
        const state = `应用执行记录（只描述工具操作，不代表对话解释是否正确）：${JSON.stringify(snapshot).slice(0, 12_000)}`;
        prompt += `\n${state}`;
        messages?.splice(Math.max(0, messages.length - 1), 0, { role: "observation", content: state });
      }
      for (const evidence of context.evidence) { candidate(evidence.citation); rememberEvidence(evidence); }
      activity("context", options.contextAllowed ? "已读取学习进度与资料依据" : "仅使用本轮对话内容", "completed");
    }
    contextMs = Date.now() - started;
    activity("answer", "组织回答", "running");
    const result = await collectInvocation(providerRuntime(options.providerId, options.client), {
      execution, resumeInput: options.resumeInput, steerId: options.steerId, materialContext: options.contextAllowed, contextAccess: options.permissions,
      freshObservations: messages?.filter(message => message.role === "observation"),
      canParallelTool: (name) => tools?.harness.isParallelSafe(name) ?? false,
      canReplayTool: (name) => tools?.harness.isReplaySafe(name) ?? false,
      role: "tutor", providerId: options.providerId, prompt, messages,
      reasoning: options.reasoning, onUsage: options.onUsage,
      responsePurpose: options.structured ? "internal" : "answer",
      responseCheck: options.responseCheck ?? (!options.structured && isContinuableModelClient(options.client) ? text => {
        const support = inspectEvidenceSupport(text, [...sourceEvidence.values()]); options.onEvidenceSupport?.(support);
        return (sourceEvidence.size ? evidenceRepairReason(support) : undefined) ?? responseRepairReason(text, options.question);
      } : undefined),
      onTiming: options.onTiming,
      onContext: options.onContext,
      onProgress: (phase) => activity("model", modelPhaseLabels[phase], "running"),
      onTurn: options.onTurn, shouldPause: () => waiting,
      toolState: (name) => {
        const resource = name ? tools?.harness.resource(name) : undefined;
        const local = resource ? "" : tasks?.snapshot(taskId, options.topicId!).operations.filter(item => item.status === "completed").map(item => item.key).sort().join(":") ?? "";
        const journal = execution?.read();
        const effects = [...(journal?.history ?? []), ...(journal?.pending ? [journal.pending] : [])].flatMap(turn => turn.toolResults)
          .filter(item => tools?.harness.resource(item.tool) && (!resource || tools.harness.resource(item.tool) === resource) && tools?.harness.risk(item.tool) !== "read" && (item.result as { ok?: boolean } | null)?.ok === true)
          .map(item => item.callId).join(":");
        return `${local}|${effects}`;
      },
      completionCheck: async (signal) => {
        const snapshot = tasks ? await verifiedTaskSnapshot(options.application!, tasks, taskId, options.topicId!, signal) : undefined;
        const pending = snapshot?.plan.filter(step => !step.completed);
        return pending?.length ? pending.map(step => step.title).join("、") : undefined;
      },
      containsUserMaterials: true, confirmed: true, allowFallback: false, requireDone: true,
      // Multi-file read/edit/test cycles need more bounded rounds than short learning queries.
      limits: { ...(tools?.definitions.some(tool => tool.name.startsWith("project_")) ? { maxTurns: 12 } : {}), ...options.limits },
      tools: tools?.definitions,
      advertisedTools: catalog?.advertised,
      onText: options.onText,
      onAudit: async (value) => { trace = value; await options.onAudit?.(value); },
      onToolCall: tools ? async (name, input, toolSignal, callId) => {
        if (options.readOnly && (tools!.harness.risk(name) !== "read" || ["ask_user", "plan_task"].includes(name))) return { ok: false, errorCode: "tool_policy_denied" };
        const decision = callId ? execution?.read()?.decisions[callId] : undefined;
        if (name === "ask_user" && decision) return { ok: true, output: { answer: decision.answer } };
        const risk = tools!.harness.preview(name, input, options.topicId ?? "general-chat").risk;
        const journal = execution?.read();
        const reportedExternal = risk !== "read" && [...(journal?.history ?? []), ...(journal?.pending ? [journal.pending] : [])].some(turn => turn.toolResults.some(result => result.tool === name && (result.result as { source?: string } | null)?.source === "user_report"));
        if (risk !== "read" && decision?.answer === "deny") return { ok: false, errorCode: "tool_policy_denied" };
        const labels: Record<string, string> = { learning_progress: "查看学习进度", list_materials: "查看资料目录", search_materials: "检索资料", task_status: "恢复任务进度", plan_task: "整理执行步骤", save_artifact: "保存学习产物", run_experiment: "运行实验测试" };
        const key = `tool-${++toolSequence}`;
        activity(key, labels[name] ?? "执行学习查询", "running");
        const grant = writePermission(name, input, options.topicId ?? "general-chat");
        const writeAllowed = decision?.answer === "allow" || !reportedExternal && (options.writeGrants?.some(item => item.key === grant.key) || options.allowWrites && grant.kind === "learning");
        if (reportedExternal && decision?.answer !== "allow" && !options.onInteraction) return { ok: false, errorCode: "tool_policy_denied" };
        if (risk !== "read" && !writeAllowed && options.onInteraction) {
          const preview = await tools!.harness.validatedPreview(name, input, { topicId: options.topicId!, signal: toolSignal, callId });
          pause(callId);
          await options.onInteraction({ id: interactionId(taskId, callId), callId, kind: "approval", title: name === "save_artifact" ? "保存这份学习产物" : name === "run_experiment" ? "运行当前实现与测试" : `执行 ${name}`, tool: name, input: preview.input as Record<string, unknown>, preview: preview.preview, permissionLabel: grant.label, status: "pending" });
          waiting = true; activity(key, "等待你授权这项操作", "completed");
          return { ok: false, errorCode: "approval_required" };
        }
        activity("model", "模型请求已完成", "completed");
        const toolStarted = Date.now();
        const harness = writeAllowed && ["save_artifact", "run_experiment"].includes(name) && options.application && options.topicId ? options.application.tools(true, { taskId, allowWrites: true }).harness : tools!.harness;
        await options.onTool?.(name, "started");
        const result = await harness.execute(name, input, { topicId: options.topicId ?? "general-chat", signal: toolSignal, callId, maxRisk: writeAllowed ? "write" : "read" }).finally(() => { toolMs += Date.now() - toolStarted; });
        await options.onTool?.(name, result.ok ? "finished" : "failed");
        const receipt = options.onToolReceipt ? executionEvidence(taskId, callId ?? key, name, input, result) : undefined;
        if (receipt) await options.onToolReceipt!(receipt);
        if (name === "save_artifact" && result.ok) {
          const artifact = result.output as { id: string }; const value = input as { dayId: string; kind: string; text: string };
          options.onItem?.({ id: randomUUID(), kind: "artifact", artifactId: artifact.id, dayId: value.dayId, artifactKind: value.kind, text: value.text });
        }
        if (name === "search_materials" && result.ok && Array.isArray(result.output)) {
          for (const value of result.output) {
            const parsed = citationSchema.safeParse((value as { citation?: unknown }).citation);
            if (parsed.success && parsed.data.topicId === options.topicId) {
              candidate(parsed.data);
              const text = (value as { text?: unknown }).text;
              if (typeof text === "string") rememberEvidence({ citation: parsed.data, text, score: 0 });
            }
          }
        }
        const staleSkill = ["list_skills", "read_skill"].includes(name) && result.ok && (Array.isArray(result.output) ? result.output : [result.output]).some(item => (item as { status?: string } | null)?.status === "stale");
        activity(key, staleSkill ? "技能更新未通过校验，使用上次有效的参考流程" : labels[name] ?? "执行学习查询", result.ok ? "completed" : "failed");
        return receipt ? { ...result, receipt } : result;
      } : undefined,
    }, signal);
    if (!result.waiting && (result.partial || !(result.finalText ?? result.text).trim())) throw new Error(result.stopReason ?? "provider_incomplete");
    if (!result.blocked) options.onEvidenceSupport?.(inspectEvidenceSupport(result.finalText ?? result.text, [...sourceEvidence.values()]));
    for (const citation of candidates.values()) if ((result.finalText ?? result.text).includes(citationMarker(citation))) options.onCitation(citation);
    activity("answer", result.waiting ? "等待你的回复" : "回答已完成", "completed");
    activity("model", result.waiting ? "等待你的回复" : "模型请求已完成", "completed");
    ledger?.finish(options.runId, result.waiting ? "waiting" : result.blocked ? "failed" : "completed", result.blocked ? "task_incomplete" : undefined);
    const task = tasks?.snapshot(taskId, options.topicId!);
    return { contextMs, modelMs: Date.now() - started - contextMs, toolMs, turns: trace?.turns ?? 0, toolCalls: trace?.toolCalls ?? 0, waiting: result.waiting, ...(result.blocked ? { blocked: true, stopReason: result.stopReason } : {}), ...(task?.plan.length ? { taskCompleted: task.completed } : {}) };
  } catch (error) {
    activity("model", signal.aborted ? "模型请求已停止" : "模型请求未完成", "failed");
    activity("answer", signal.aborted ? "任务已停止" : "本轮未完成", "failed");
    ledger?.finish(options.runId, signal.aborted ? "cancelled" : "failed", signal.aborted ? "cancelled" : "assistant_failed");
    throw error;
  } finally { await external?.close(); }
}
