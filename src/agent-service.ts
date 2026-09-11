import { retryableTask } from "./team-task-graph.js";
import { executeAgent, isAgentExecutor, type AgentBackend } from "./agent-executor.js";
import { imageDataUrl } from "./image-input.js";
import { capabilitiesFor } from "./model-capabilities.js";
import { prepareDialogue } from "./agent-dialogue.js";
import { TeamCoordinator } from "./team-coordinator.js";
import { teamConfigurationSchema } from "./team-contracts.js";
import { MAX_CONVERSATION_MESSAGES, MAX_PENDING_REQUESTS } from "./input-limits.js";
import { restrictedStudy } from "./outcome-contracts.js";
import { accessSelection, bindPermissions, retainGrants, writePermission, type AccessSelection } from "./agent-permissions.js";
import { McpSettings } from "./mcp-settings.js";
import { randomUUID } from "node:crypto";
import { planConversationSummary } from "./conversation-summary.js";
import { excerpt } from "./conversation-context.js";
import type { LearningApplication } from "./learning-application.js";
import { providerRuntime, runAssistantTask } from "./assistant-runtime.js";
import { collectInvocation } from "./model-invocation.js";
import { agentReply, type AgentReply } from "./agent-reply.js";
import {
  agentSendSchema as sendSchema,
  type ChatSession,
  type AgentEvent,
  type SendRequest,
} from "./agent-session-contracts.js";
import { AgentSessionStore } from "./agent-session-store.js";
import { AgentExecutionStore } from "./agent-execution-store.js";
import { buildMessages } from "./learning-agent-profile.js";
import { publicError } from "./agent-errors.js";

import type { ModelAuditRecord } from "./model-audit.js";
import { selectReasoning } from "./agent-efficiency.js";
import { ContinuationText, inspectResponse, normalizeDisplayMath } from "./response-quality.js";
import { citationMarker } from "./citation-marker.js";
import { TaskContinuity, type RecoveryReport } from "./task-continuity.js";
import { TaskExecutionStore } from "./task-execution.js";
import { verifyMcpRecovery } from "./mcp-recovery.js";
export interface AgentObserver {
  signal?: AbortSignal;
  onText?: (text: string, providerId: string) => void;
  onAudit?: (record: ModelAuditRecord) => void | Promise<void>;
  onTool?: (name: string, phase: "started" | "finished" | "failed") => void | Promise<void>;
}
export class AgentService<Store extends AgentSessionStore = AgentSessionStore> {
  private activeTeam?: TeamCoordinator;
  async stopTeamMember(sessionId: string, memberId: string): Promise<void> {
    if (this.activeSessionId !== sessionId || !this.activeTeam) throw new Error("team_member_not_active");
    await this.activeTeam.stopMember(memberId);
  }
  private eventSequence = 0;
  private listeners = new Set<(event: AgentEvent) => void>();
  private active: { session: ChatSession; controller: AbortController } | null =
    null;
  private draining: string | null = null;
  private drainingSession: ChatSession | null = null;
  private startingSessionId: string | null = null;
  private stopGeneration = 0;
  private starting = false;
  private work: Promise<void> = Promise.resolve();
  private pendingEnqueues = new Set<Promise<void>>();
  private maintenance: Promise<void> = Promise.resolve();
  private maintenanceController?: AbortController;
  private interactionController?: AbortController;
  constructor(
    readonly store: Store,
    private readonly client: (provider: SendRequest["provider"]) => AgentBackend,
    readonly learning?: LearningApplication,
  ) {}
  /** Blocking adapter over the exact same send path. Observers cannot supply model inputs. */
  async invoke(request: SendRequest, observer: AgentObserver = {}): Promise<AgentReply> {
    let messageId: string | undefined;
    const cancel = () => { if (this.active?.session.id === request.sessionId && (!messageId || this.active.session.messages.at(-1)?.id === messageId) || !messageId && this.startingSessionId === request.sessionId) this.stop(); };
    observer.signal?.throwIfAborted();
    let settled!: () => void;
    const completion = new Promise<void>(resolve => { settled = resolve; });
    const unsubscribe = this.subscribe(event => { if (event.type === "settled" && event.sessionId === request.sessionId) settled(); });
    observer.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const sent = await this.send(request, false, undefined, observer);
      messageId = sent.messages.at(-1)!.id;
      await completion;
      const message = (await this.load(request.sessionId)).messages.find(item => item.id === messageId);
      if (!message) throw new Error("message_not_found");
      if (observer.signal?.aborted || message.status === "interrupted") throw new DOMException("cancelled", "AbortError");
      if (message.status === "failed" && !message.text.trim()) throw new Error(`本轮未完成：${message.error ?? "模型没有返回完整回答。"}`);
      return agentReply(message, request.provider);
    } finally { unsubscribe(); observer.signal?.removeEventListener("abort", cancel); }
  }
  executionEvents(sessionId: string, taskId: string, topicId: string) {
    if (!this.learning) throw new Error("workspace_unavailable");
    return new AgentExecutionStore(this.learning.database, { taskId, sessionId, topicId }).events();
  }
  private taskIdentity(session: ChatSession, taskId: string) {
    if (!this.learning || session.workspaceId && session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
    if (!session.messages.some(message => message.taskId === taskId)) throw new Error("task_not_found");
    return { taskId, sessionId: session.id, topicId: session.topicId ?? "general-chat" };
  }
  async taskInfo(sessionId: string, taskId: string) {
    const session = await this.load(sessionId); const identity = this.taskIdentity(session, taskId);
    return new TaskContinuity(this.learning!.database).inspect(identity);
  }
  async reportRecovery(sessionId: string, taskId: string, callId: string, report: RecoveryReport) {
    if (this.activeSessionId || this.starting) throw new Error("run_active");
    await this.pauseMaintenance();
    return this.withStoredSession(sessionId, async session => {
      const identity = this.taskIdentity(session, taskId); const continuity = new TaskContinuity(this.learning!.database);
      continuity.report(identity, callId, report); session.executionAllowed = false; session.writeGrants = [];
      await this.store.save(session); this.emit({ type: "session", session }); return continuity.inspect(identity);
    });
  }
  async verifyRecovery(sessionId: string, taskId: string, callId: string) {
    if (this.activeSessionId || this.starting) throw new Error("run_active");
    await this.pauseMaintenance(); this.starting = true; this.startingSessionId = sessionId;
    const controller = new AbortController(); this.interactionController = controller;
    try {
      return await this.withStoredSession(sessionId, async session => {
        const identity = this.taskIdentity(session, taskId);
        if (session.permissions) {
          if (session.permissions.externalRevision === undefined) throw new Error("execution_context_required");
          bindPermissions(this.learning!, identity.topicId, accessSelection(session.permissions), session.permissions);
        }
        return verifyMcpRecovery(this.learning!.database, identity, callId, controller.signal);
      });
    } finally { this.starting = false; this.startingSessionId = null; this.interactionController = undefined; }
  }
  async reviseTask(sessionId: string, taskId: string, revision: number, goal: string): Promise<ChatSession> {
    if (this.activeSessionId || this.starting) throw new Error("run_active");
    await this.pauseMaintenance();
    const request = await this.withStoredSession(sessionId, async session => {
      const identity = this.taskIdentity(session, taskId); const continuity = new TaskContinuity(this.learning!.database);
      if (continuity.inspect(identity).recovery) throw new Error("tool_recovery_required");
      const tasks = new TaskExecutionStore(this.learning!.database); tasks.begin(taskId, identity.topicId, session.context?.goal ?? goal);
      tasks.revise(taskId, identity.topicId, revision, goal);
      const message = session.messages.findLast(item => item.taskId === taskId)!;
      return { sessionId, text: `用户已明确修订本任务目标：${goal}\n旧计划已归档，以新目标重新规划，实际已发生的操作仍保留。`, provider: message.provider ?? "pi-codex", style: message.style ?? "adaptive", reasoning: message.reasoning, collaboration: message.collaboration, resumeTaskId: taskId, steerId: randomUUID() } satisfies SendRequest;
    });
    return this.send(request);
  }
  get activeTaskId(): string | undefined { return this.active?.session.messages.at(-1)?.taskId; }
  get activeSessionId(): string | null {
    return this.active?.session.id ?? this.draining ?? this.startingSessionId;
  }
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private patch(session: ChatSession, changes: Partial<Omit<ChatSession["messages"][number], "id">>): void {
    this.emit({ type: "message_patch", sessionId: session.id, messageId: session.messages.at(-1)!.id, sequence: ++this.eventSequence, changes });
  }
  private emit(event: AgentEvent): void {
    // A disconnected transport must not own task execution or prevent delivery to others.
    for (const listener of this.listeners) {
      try { void Promise.resolve(listener(structuredClone(event))).catch(() => { this.listeners.delete(listener); }); }
      catch { this.listeners.delete(listener); }
    }
  }
  create(): Promise<ChatSession> {
    return this.store.create();
  }
  async openOutcomeLesson(topicId: string, id: string): Promise<ChatSession> {
    if (this.activeSessionId) throw new Error("run_active");
    if (!this.learning) throw new Error("workspace_unavailable");
    this.learning.registry.get(topicId);
    const trial = this.learning.outcomes.get(topicId, id);
    if (trial.stage !== "lesson") throw new Error("outcome_stage_invalid");
    this.starting = true; this.startingSessionId = id;
    try {
      if (trial.protocol === "full_product") this.learning.outcomes.bindProvenance(topicId, id, await this.learning.provenance());
      if (trial.sessionId) {
        const session = await this.load(trial.sessionId);
        if (session.workspaceId !== this.learning.summary().id || session.topicId !== topicId || session.study?.id !== id || session.study.mode !== trial.mode || (session.study.protocol ?? "prompt_only") !== (trial.protocol ?? "prompt_only")) throw new Error("outcome_session_mismatch");
        return session;
      }
      const session = await this.create();
      session.study = { id, mode: trial.mode, protocol: trial.protocol ?? "prompt_only" }; session.topicId = topicId;
      session.workspaceId = this.learning.summary().id;
      session.contextAllowed = false; session.executionAllowed = false;
      session.title = `${trial.title} · ${trial.mode === "zhixing" ? "引导教学" : "直接聊天"}`; session.customTitle = true;
      await this.store.save(session);
      this.learning.outcomes.attachSession(topicId, id, session.id);
      return session;
    } finally { this.starting = false; this.startingSessionId = null; }
  }
  async finishOutcomeLesson(topicId: string, id: string) {
    if (this.activeSessionId) throw new Error("run_active");
    if (!this.learning) throw new Error("workspace_unavailable");
    const trial = this.learning.outcomes.get(topicId, id);
    if (!trial.sessionId) throw new Error("outcome_lesson_incomplete");
    const session = await this.load(trial.sessionId);
    if (session.workspaceId !== this.learning.summary().id || session.topicId !== topicId || session.study?.id !== id || session.study.mode !== trial.mode || (session.study.protocol ?? "prompt_only") !== (trial.protocol ?? "prompt_only")) throw new Error("outcome_session_mismatch");
    if (session.pendingRequests?.length || session.messages.at(-1)?.status !== "completed") throw new Error("outcome_lesson_incomplete");
    const messages = session.messages.filter(m => m.role === "assistant");
    return this.learning.outcomes.finishLesson(topicId, id, { sessionId: session.id,
      conditions: messages.map(m => ({ provider: m.provider ?? "unknown", model: m.model, reasoning: m.reasoning ?? "unknown", style: m.style ?? "unknown", codeHash: m.codeHash, windowTokens: m.contextUsage?.windowTokens, reserveOutputTokens: m.contextUsage?.reservedOutputTokens })),
      toolCalls: messages.reduce((total, m) => total + (m.timings?.toolCalls ?? 0), 0), access: messages.flatMap(m => m.access ? [m.access] : []),
      completedTurns: messages.filter(m => m.status === "completed" && m.text.trim()).length,
      failedTurns: messages.filter(m => m.status !== "completed").length,
      durationMs: messages.reduce((total, m) => total + (m.durationMs ?? 0), 0),
    });
  }
  async load(id: string): Promise<ChatSession> {
    if (this.active?.session.id === id) return structuredClone(this.active.session);
    const session = await this.store.load(id);
    this.reconcileSupersededInteractions(session);
    const last = session.messages.at(-1);
    if (last?.status === "waiting" && last.taskId && !session.messages.some(message => message.taskId === last.taskId && message.items?.some(item => (item.kind === "approval" || item.kind === "question") && item.status === "pending"))) {
      // The reply may have committed immediately before a crash/provider startup failure.
      // Expose the existing retry/continue action without replaying any operation on load.
      last.status = "interrupted";
    }
    return session;
  }
  private reconcileSupersededInteractions(session: ChatSession): void {
    const taskId = session.messages.at(-1)?.taskId;
    if (!this.learning || !taskId || session.workspaceId && session.workspaceId !== this.learning.summary().id) return;
    const cards = session.messages.filter(message => message.taskId === taskId).flatMap(message => message.items ?? [])
      .filter(item => (item.kind === "approval" || item.kind === "question") && item.status === "pending");
    if (!cards.length) return;
    try {
      const checkpoint = new AgentExecutionStore(this.learning.database, { taskId, sessionId: session.id, topicId: session.topicId ?? "general-chat" }).read();
      const results = checkpoint?.history.flatMap(turn => turn.toolResults) ?? [];
      for (const card of cards) {
        if (card.kind !== "approval" && card.kind !== "question") continue;
        const result = results.find(item => item.callId === card.callId)?.result as { errorCode?: string } | undefined;
        if (result?.errorCode === "tool_superseded" || result?.errorCode === "tool_interrupted") {
          card.status = "answered";
          card.answer = result.errorCode === "tool_superseded" ? "任务已调整，此调用未执行" : "任务已调整，上次操作结果待核对";
        }
      }
    } catch { /* Unreadable journals never resolve cards or grant permission; history remains viewable. */ }
  }
  private async withStoredSession<T>(id: string, action: (session: ChatSession) => Promise<T>): Promise<T> {
    const release = this.learning ? AgentExecutionStore.claimSession(this.learning.database, id) : undefined;
    try { return await action(await this.store.load(id)); }
    finally { release?.(); }
  }
  async rename(id: string, title: string): Promise<ChatSession> {
    if (this.activeSessionId === id) throw new Error("run_active");
    await this.pauseMaintenance();
    return this.withStoredSession(id, async session => {
      session.title = title.trim().slice(0, 80);
      session.customTitle = true;
      await this.store.save(session);
      return session;
    });
  }
  async fork(id: string, messageId?: string, edit = false): Promise<ChatSession> {
    if (this.activeSessionId) throw new Error("run_active");
    const source = await this.load(id); const index = messageId ? source.messages.findIndex((item) => item.id === messageId) : source.messages.length - 1;
    if (messageId && index < 0 || edit && source.messages[index]?.role !== "user") throw new Error("message_not_found");
    const fork = await this.store.create();
    fork.title = `${source.title.slice(0, 70)} · 分支`; fork.customTitle = true;
    fork.parent = { sessionId: id, messageId };
    fork.topicId = source.topicId; fork.workspaceId = source.workspaceId; fork.contextAllowed = false; fork.executionAllowed = false; fork.permissions = { version: 1, materials: false }; fork.writeGrants = [];
    fork.messages = source.messages.slice(0, index + (edit ? 0 : 1)).map((item) => ({ ...item, taskId: undefined, items: item.items?.filter((entry) => !["approval", "question"].includes(entry.kind)) }));
    fork.context = source.context ? { goal: edit && index === 0 ? "" : source.context.goal, notes: source.context.notes } : undefined;
    await this.store.save(fork); return fork;
  }
  async answerInteraction(sessionId: string, itemId: string, answer: string, scope: "once" | "session" = "once"): Promise<ChatSession> {
    if (this.activeSessionId) throw new Error("run_active");
    this.starting = true; this.startingSessionId = sessionId;
    const controller = new AbortController(); this.interactionController = controller;
    let request: SendRequest;
    let release: (() => void) | undefined;
    try { release = this.learning ? AgentExecutionStore.claimSession(this.learning.database, sessionId) : undefined; request = await this.resolveInteraction(sessionId, itemId, answer, scope, controller.signal); }
    finally { release?.(); this.starting = false; this.startingSessionId = null; this.interactionController = undefined; }
    controller.signal.throwIfAborted();
    return this.send(request);
  }
  private async resolveInteraction(sessionId: string, itemId: string, answer: string, scope: "once" | "session", signal: AbortSignal): Promise<SendRequest> {
    const session = await this.load(sessionId);
    const message = session.messages.find((entry) => entry.items?.some((item) => item.id === itemId));
    const item = message?.items?.find((entry) => entry.id === itemId);
    if (!message || !item || !["approval", "question"].includes(item.kind) || !("status" in item) || item.status !== "pending") throw new Error("interaction_resolved");
    if (!answer.trim() || answer.length > 4000) throw new Error("interaction_invalid");
    if (item.callId) {
      if (!this.learning || !message.taskId || session.workspaceId && session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
      if (item.kind === "approval" && !["allow", "deny"].includes(answer)) throw new Error("interaction_invalid");
      const execution = new AgentExecutionStore(this.learning.database, { taskId: message.taskId, sessionId, topicId: session.topicId ?? "general-chat" });
      if (session.permissions && session.topicId) bindPermissions(this.learning, session.topicId, accessSelection(session.permissions), session.permissions);
      if (item.kind === "approval" && answer === "allow" && session.permissions) {
        const kind = writePermission(item.tool, item.input, session.topicId ?? "general-chat").kind;
        if (kind === "learning" ? !session.permissions.materials : kind === "project" ? !session.permissions.projectId : session.permissions.externalRevision === undefined) throw new Error("execution_context_required");
      }
      execution.decide(item.callId, answer, scope);
      if (item.kind === "approval" && answer === "allow" && scope === "session") this.rememberPermission(session, item.tool, item.input);
      item.status = "answered"; item.answer = answer; session.queuePaused = false;
      await this.store.save(session);
      return { sessionId, text: item.kind === "question" ? answer : answer === "allow" ? `已授权：${item.title}` : `已拒绝：${item.title}`, provider: message.provider ?? "pi-codex", style: message.style ?? "adaptive", reasoning: message.reasoning, collaboration: message.collaboration, resumeTaskId: message.taskId };
    }
    // Version 1/2 cards without a journal retain their original compatibility path.
    let text = `对“${item.title}”的回复：${answer}`;
    if (item.kind === "approval") {
      if (!["allow", "deny"].includes(answer)) throw new Error("interaction_invalid");
      if (answer === "allow") {
        if (!this.learning || !session.topicId || !message.taskId || session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
        const tools = this.learning.tools(true, { taskId: message.taskId, allowWrites: true });
        const result = await tools.harness.execute(item.tool, item.input, { topicId: session.topicId, maxRisk: "write", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
        signal.throwIfAborted();
        text = `已授权 ${item.title}。应用执行结果：${JSON.stringify(result).slice(0, 12_000)}。接着完成原任务，已完成操作不要重复。`;
        if (scope === "session") this.rememberPermission(session, item.tool, item.input);
        if (item.tool === "save_artifact" && result.ok) message.items!.push({ id: randomUUID(), kind: "artifact", artifactId: (result.output as { id: string }).id, dayId: String(item.input.dayId), artifactKind: String(item.input.kind), text: String(item.input.text) });
      } else text = `我拒绝“${item.title}”，不要执行这项操作。继续能完成的其余部分。`;
    }
    item.status = "answered"; item.answer = answer;
    session.queuePaused = false;
    await this.store.save(session);
    return { sessionId, text, provider: message.provider ?? "pi-codex", style: "adaptive", reasoning: message.reasoning, collaboration: message.collaboration, resumeTaskId: message.taskId };
  }
  async send(raw: SendRequest, fromQueue = false, queuedRequestId?: string, observer?: AgentObserver, prepare?: () => Promise<void>): Promise<ChatSession> {
    const request = sendSchema.parse(raw);
    request.reasoning ??= "balanced";
    if (this.active || this.starting || this.draining && !fromQueue) throw new Error("run_active");
    this.maintenanceController?.abort();
    this.starting = true;
    this.startingSessionId = request.sessionId;
    const generation = this.stopGeneration;
    let releaseSession: (() => void) | undefined; let releaseTeaching: (() => void) | undefined; let handedOff = false;
    try {
      await this.pauseMaintenance();
      // Transport preference reads belong inside the same cancellation boundary.
      await prepare?.();
      releaseSession = this.learning ? AgentExecutionStore.claimSession(this.learning.database, request.sessionId) : undefined;
      const client = this.client(request.provider);
      if (request.images?.length && !capabilitiesFor(client).inputModalities.includes("image")) throw new Error("image_model_required");
      const session = await this.store.load(request.sessionId);
      if (request.retryTeamTaskId && (!request.resumeTaskId || request.steerId)) throw new Error("team_task_not_retryable");
      if (request.resumeTaskId) {
        const previous = session.messages.findLast(item => item.taskId === request.resumeTaskId);
        request.collaboration ??= previous?.collaboration;
        if (request.retryTeamTaskId) retryableTask(previous?.team?.tasks, request.retryTeamTaskId);
        if (previous?.team) {
          request.reasoning = previous.reasoning;
          const original = session.messages.slice(0, session.messages.indexOf(previous)).findLast(item => item.role === "user");
          if (request.images && JSON.stringify(request.images) !== JSON.stringify(original?.images)) throw new Error("team_scope_changed");
          request.images ??= original?.images;
          if (request.images?.length && !capabilitiesFor(client).inputModalities.includes("image")) throw new Error("image_model_required");
        }
        if (JSON.stringify(teamConfigurationSchema.parse(request.collaboration ?? {})) !== JSON.stringify(teamConfigurationSchema.parse(previous?.collaboration ?? {})) || previous?.team && previous.provider !== request.provider) throw new Error("team_configuration_changed");
      }
      if (session.study) {
        if (!this.learning || !session.topicId || session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
        const trial = this.learning.outcomes.get(session.topicId, session.study.id);
        if (trial.sessionId !== session.id || trial.mode !== session.study.mode || (trial.protocol ?? "prompt_only") !== (session.study.protocol ?? "prompt_only")) throw new Error("outcome_session_mismatch");
        if (trial.stage !== "lesson") throw new Error("outcome_stage_invalid");
        if (restrictedStudy(session.study)) { request.contextAllowed = false; request.execution = "read"; request.access = { materials: false, project: false, external: false }; }
      }
      if (fromQueue && (this.drainingSession?.queuePaused || generation !== this.stopGeneration)) throw new Error("queue_paused");
      session.pendingRequests ??= [];
      if (queuedRequestId) session.pendingRequests = session.pendingRequests.filter((item) => item.id !== queuedRequestId);
      if (request.mode) session.mode = request.mode;
      session.context ??= { goal: excerpt(session.messages.find((item) => item.role === "user")?.text ?? request.text, 4000), notes: "" };
      if (request.topicId) {
        if (!this.learning) throw new Error("workspace_unavailable");
        this.learning.registry.get(request.topicId);
        if (session.messages.length && session.topicId !== request.topicId) throw new Error("topic_change_requires_new_session");
        session.topicId = request.topicId;
      }
      if (session.topicId) {
        if (!this.learning || session.workspaceId && session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
        session.workspaceId = this.learning.summary().id;
        const legacyMaterials = request.contextAllowed ?? session.contextAllowed ?? false;
        const selection = fromQueue && session.permissions ? { materials: session.permissions.materials && request.contextAllowed !== false && request.access?.materials !== false, project: Boolean(session.permissions.projectId) && request.access?.project !== false, external: session.permissions.externalRevision !== undefined && request.access?.external !== false } : request.access ?? (session.permissions ? { ...accessSelection(session.permissions), materials: request.contextAllowed ?? session.permissions.materials } : { materials: legacyMaterials, project: legacyMaterials && Boolean(this.learning.projects.selected(session.topicId)), external: legacyMaterials && new McpSettings(this.learning.database).read(session.topicId).servers.some(server => server.enabled) });
        const permissions = bindPermissions(this.learning, session.topicId, selection, session.permissions);
        this.revokePendingApprovals(session, permissions);
        session.writeGrants = retainGrants(session.writeGrants, session.permissions, permissions);
        session.permissions = permissions;
        session.contextAllowed = permissions.materials;
      }
      if (/^(?:开始第\s*\d+\s*天|开始任务)$/.test(request.text)) session.mode = "lesson";
      if (session.mode === "lesson" && session.contextAllowed && session.topicId && this.learning) releaseTeaching = AgentExecutionStore.claimTeaching(this.learning.database, session.topicId);
      if (session.contextAllowed && session.topicId && this.learning && session.teaching === undefined) session.teaching = session.parent ? null : await this.learning.teaching.load(session.topicId) ?? null;
      if (session.mode === "lesson" && session.contextAllowed && !session.messages.length && session.topicId && this.learning) {
        const checkpoint = session.teaching;
        for (const text of checkpoint?.transcript ?? []) session.messages.push({ id: randomUUID(), role: /^(?:教师|助手)/.test(text) ? "assistant" : "user", text: text.replace(/^(?:教师|助手|用户)[:：]/, ""), status: "completed", createdAt: checkpoint!.updatedAt });
      }
      if (session.messages.length > MAX_CONVERSATION_MESSAGES - 2) throw new Error("session_full");
      if (request.resumeTaskId && !session.messages.some((item) => item.taskId === request.resumeTaskId)) throw new Error("task_not_found");
      if (request.resumeTaskId) request.steerId ??= session.messages.findLast(item => item.taskId === request.resumeTaskId)?.steerId;
      if (fromQueue) request.execution = session.executionAllowed && request.execution !== "read" ? "session" : "read";
      if (!session.contextAllowed) request.execution = "read";
      if (request.execution === "session") session.executionAllowed = true;
      if (request.execution === "read") session.executionAllowed = false;
      if (!session.messages.length && !session.customTitle)
        session.title = request.text.replace(/\s+/g, " ").slice(0, 48);
      const now = new Date().toISOString();
      session.updatedAt = now;
      session.messages.push({
        id: randomUUID(),
        role: "user",
        text: request.text,
        ...(request.images ? { images: request.images } : {}),
        status: "completed",
        createdAt: now,
      });
      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        text: "",
        status: "running",
        createdAt: now,
        provider: request.provider,
        style: request.style,
        collaboration: request.collaboration,
        reasoning: selectReasoning(request.text, request.reasoning, Boolean(request.resumeTaskId || request.execution && request.execution !== "read")),
        ...(request.reasoning === "auto" ? { reasoningMode: "auto" as const } : {}),
        taskId: request.resumeTaskId ?? randomUUID(),
        steerId: request.steerId,
      });
      await this.store.save(session);
      const controller = new AbortController();
      if (generation !== this.stopGeneration) { session.queuePaused = true; controller.abort(); }
      this.active = { session, controller };
      const snapshot = structuredClone(session);
      this.emit({ type: "session", session });
      this.work = this.generate(session, request, controller, client, isolateObserver(observer), () => { releaseTeaching?.(); releaseSession?.(); });
      handedOff = true;
      return snapshot;
    } finally {
      if (!handedOff) { releaseTeaching?.(); releaseSession?.(); }
      this.starting = false;
      this.startingSessionId = null;
    }
  }
  stop(): void {
    this.interactionController?.abort();
    this.maintenanceController?.abort();
    this.stopGeneration += 1;
    if (this.active) this.active.session.queuePaused = true;
    if (this.drainingSession) this.drainingSession.queuePaused = true;
    this.active?.controller.abort();
  }
  async enqueue(raw: SendRequest, steer = false): Promise<ChatSession> {
    const request = sendSchema.parse(raw);
    if (request.images?.length && !capabilitiesFor(this.client(request.provider)).inputModalities.includes("image")) throw new Error("image_model_required");
    const active = this.active;
    if (!active || active.session.id !== request.sessionId) throw new Error("no_active_task");
    if (request.topicId && request.topicId !== active.session.topicId) throw new Error("topic_change_requires_new_session");
    const pending = active.session.pendingRequests ??= [];
    if (pending.length >= MAX_PENDING_REQUESTS || active.session.messages.length + (pending.length + 1) * 2 > MAX_CONVERSATION_MESSAGES) throw new Error("queue_full");
    const item = { id: randomUUID(), collaboration: request.collaboration, mode: request.mode, purpose: request.purpose, images: request.images, text: request.text, provider: request.provider, style: request.style, reasoning: request.reasoning, topicId: request.topicId, contextAllowed: request.contextAllowed, access: request.access, execution: request.execution, retryTeamTaskId: request.retryTeamTaskId, resumeTaskId: steer ? active.session.messages.at(-1)?.taskId : request.resumeTaskId, steerId: steer ? randomUUID() : request.steerId, enqueuedAt: new Date().toISOString() };
    if (steer) pending.unshift(item); else pending.push(item);
    active.session.queuePaused = false;
    active.session.queueError = undefined;
    const saved = this.store.save(active.session).catch((error) => {
      active.session.pendingRequests = active.session.pendingRequests?.filter((request) => request.id !== item.id);
      active.session.queuePaused = true;
      throw error;
    });
    this.pendingEnqueues.add(saved);
    try { await saved; }
    finally { this.pendingEnqueues.delete(saved); }
    if (this.active === active) this.emit({ type: "session", session: active.session });
    if (steer && this.active === active) active.controller.abort();
    return structuredClone(active.session);
  }
  async withdraw(sessionId: string, requestId: string): Promise<ChatSession> {
    if (this.active?.session.id === sessionId) {
      this.active.session.pendingRequests = this.active.session.pendingRequests?.filter((item) => item.id !== requestId);
      await this.store.save(this.active.session); this.emit({ type: "session", session: this.active.session });
      return structuredClone(this.active.session);
    }
    if (this.draining === sessionId || this.startingSessionId === sessionId) throw new Error("run_active");
    return this.withStoredSession(sessionId, async current => {
      current.pendingRequests = current.pendingRequests?.filter((item) => item.id !== requestId);
      await this.store.save(current); this.emit({ type: "session", session: current }); return current;
    });
  }
  async resumeQueue(sessionId: string): Promise<void> {
    if (this.active || this.starting || this.draining) throw new Error("run_active");
    const session = await this.withStoredSession(sessionId, async current => {
      current.queuePaused = false;
      current.queueError = undefined;
      await this.store.save(current); return current;
    });
    this.work = this.drain(session);
    await this.work;
  }
  private rememberPermission(session: ChatSession, tool: string, input: unknown): void {
    const grant = writePermission(tool, input, session.topicId ?? "general-chat");
    session.writeGrants = [...(session.writeGrants ?? []).filter(item => item.key !== grant.key).slice(-63), grant];
  }
  private revokePendingApprovals(session: ChatSession, after: NonNullable<ChatSession["permissions"]>): void {
    if (!this.learning || !session.topicId) return;
    const revoked = new Set<string>();
    const before = session.permissions;
    if ((before?.materials ?? session.contextAllowed) && !after.materials) revoked.add("learning");
    if (before ? before.projectId && before.projectId !== after.projectId : session.contextAllowed && !after.projectId) revoked.add("project");
    if (before ? before.externalRevision !== undefined && before.externalRevision !== after.externalRevision : session.contextAllowed && after.externalRevision === undefined) revoked.add("external");
    if (!revoked.size) return;
    for (const taskId of new Set(session.messages.flatMap(message => message.taskId ? [message.taskId] : []))) {
      const execution = new AgentExecutionStore(this.learning.database, { taskId, sessionId: session.id, topicId: session.topicId });
      const checkpoint = execution.read();
      if (!checkpoint?.pending || checkpoint.status === "completed") continue;
      const calls = checkpoint.pending.events.filter(event => event.type === "tool_call").slice(checkpoint.pending.next);
      const ids = calls.flatMap(call => call.callId && call.tool && checkpoint.decisions[call.callId]?.answer === "allow" && revoked.has(writePermission(call.tool, call.input, session.topicId!).kind) ? [call.callId] : []);
      if (!ids.length) continue;
      const release = execution.claim();
      try {
        for (const id of ids) delete checkpoint.decisions[id];
        // Keep executing/unknown state and actual receipts intact; revocation is not rollback.
        execution.save(checkpoint, "permissions_revoked");
      } finally { release(); }
      for (const message of session.messages.filter(message => message.taskId === taskId)) for (const item of message.items ?? []) {
        if (item.kind === "approval" && item.callId && ids.includes(item.callId)) { item.status = "pending"; delete item.answer; }
      }
    }
  }
  async updatePermissions(sessionId: string, selection: AccessSelection, clearWriteGrants = false): Promise<ChatSession> {
    if (this.activeSessionId || this.starting) throw new Error("run_active");
    await this.pauseMaintenance();
    return this.withStoredSession(sessionId, async session => {
      if (!this.learning || !session.topicId || restrictedStudy(session.study)) throw new Error("workspace_unavailable");
      if (session.workspaceId && session.workspaceId !== this.learning.summary().id) throw new Error("workspace_mismatch");
      const permissions = bindPermissions(this.learning, session.topicId, selection, session.permissions);
      this.revokePendingApprovals(session, permissions);
      session.writeGrants = clearWriteGrants ? [] : retainGrants(session.writeGrants, session.permissions, permissions);
      session.permissions = permissions; session.contextAllowed = permissions.materials;
      if (!permissions.materials) session.executionAllowed = false;
      await this.store.save(session); this.emit({ type: "session", session }); return session;
    });
  }
  async updateContext(sessionId: string, goal: string, notes: string): Promise<ChatSession> {
    if (this.activeSessionId === sessionId || this.starting) throw new Error("run_active");
    if (goal.length > 4000 || notes.length > 4000) throw new Error("context_limit");
    await this.pauseMaintenance();
    return this.withStoredSession(sessionId, async session => {
      session.context = { ...session.context, goal, notes };
      await this.store.save(session); this.emit({ type: "session", session }); return session;
    });
  }
  private async drain(session: ChatSession): Promise<void> {
    if (session.queuePaused || !session.pendingRequests?.length) return;
    this.draining = session.id;
    this.drainingSession = session;
    const item = session.pendingRequests[0]!;
    try {
      await this.send({ sessionId: session.id, text: item.text, collaboration: item.collaboration, images: item.images, mode: item.mode, purpose: item.purpose, provider: item.provider, style: item.style, reasoning: item.reasoning, topicId: item.topicId, contextAllowed: item.contextAllowed, access: item.access, execution: item.execution, resumeTaskId: item.resumeTaskId, retryTeamTaskId: item.retryTeamTaskId, steerId: item.steerId }, true, item.id);
      this.draining = null;
      this.drainingSession = null;
      await this.work;
    } catch (error) {
      // Another frontend now owns this session and its durable queue. Do not overwrite it
      // or turn an already settled answer into an unhandled background rejection.
      if (error instanceof Error && error.message === "session_in_use") return;
      session.queuePaused = true;
      session.queueError = error instanceof Error && error.message === "queue_paused" ? undefined : publicError(error);
      await this.withStoredSession(session.id, async current => {
        current.queuePaused = true; current.queueError = session.queueError;
        await this.store.save(current); this.emit({ type: "session", session: current });
      });
    } finally { this.draining = null; this.drainingSession = null; }
  }
  idle(): Promise<void> {
    return this.work;
  }
  async pauseMaintenance(): Promise<void> { this.maintenanceController?.abort(); await this.maintenance; }
  idleMaintenance(): Promise<void> { return this.maintenance; }
  async exportMarkdown(id: string): Promise<string> {
    const session = await this.load(id);
    return `# ${session.title}\n\n${session.messages.map((message) => `## ${message.role === "user" ? "你" : "知行"}\n\n${message.text}${message.images?.map(image => `\n\n![${image.name.replace(/[[\]]/g, "")}](${imageDataUrl(image)})`).join("") ?? ""}${message.error ? `\n\n> ${message.error}` : ""}${message.status === "interrupted" ? "\n\n> 已停止生成" : ""}`).join("\n\n")}\n`;
  }
  private async compact(session: ChatSession, client: AgentBackend, provider: SendRequest["provider"], signal: AbortSignal): Promise<void> {
    const plan = planConversationSummary(session);
    if (!plan) return;
    session.context ??= { goal: "", notes: "" };
    session.context.lastAttemptId = session.messages.at(-3)!.id;
    session.context.summaryAttemptFailed = true;
    try {
      const result = isAgentExecutor(client) ? await executeAgent(client, { prompt: plan.prompt, maxOutputChars: 4000 }, AbortSignal.any([signal, AbortSignal.timeout(20_000)])) : await collectInvocation(providerRuntime(provider, client), {
        role: "tutor", providerId: provider,
        prompt: plan.prompt,
        containsUserMaterials: true, confirmed: true, allowFallback: false, requireDone: true,
        limits: { maxTurns: 1, maxOutputChars: 4000, timeoutMs: 20_000 },
      }, signal);
      if (!("partial" in result && result.partial) && result.text.trim()) {
        session.context!.summary = result.text;
        session.context!.summaryThroughId = plan.throughId;
        session.context!.summarySourceHash = plan.sourceHash;
        session.context!.summaryAttemptFailed = false;
      }
    } catch (error) { if (signal.aborted) throw error; /* Bounded original excerpts remain available if optional compaction fails. */ }
  }
  private async generate(session: ChatSession, request: SendRequest, controller: AbortController, client: AgentBackend, observer?: AgentObserver, releaseSession?: () => void): Promise<void> {
    const message = session.messages.at(-1)!;
    const started = Date.now();
    let savedAt = started;
    let mayDrain = true;
    const timeout = AbortSignal.timeout(request.collaboration?.mode && request.collaboration.mode !== "single" ? request.collaboration.timeoutMs : 180_000);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const activities = new Map<string, number>();
    const previousAnswer = session.messages.slice(0, -2).at(-1);
    let continuation = new ContinuationText(/^(继续(?:回答|讲解|说)?|continue)[。.!！]?$/i.test(request.text.trim()) && previousAnswer?.role === "assistant" && previousAnswer.status === "interrupted" ? previousAnswer.text : "");
    let removedRepeat = 0;
    const display = (text: string) => {
      if (!text) return;
      if (message.firstTokenMs === undefined) message.firstTokenMs = Date.now() - started;
      message.text += text;
      this.emit({ type: "delta", sessionId: session.id, messageId: message.id, text });
      observer?.onText?.(text, request.provider);
    };
    try {
      if (session.study?.protocol === "full_product" && this.learning) message.codeHash = (await this.learning.provenance()).codeHash;
      message.access = session.permissions ? accessSelection(session.permissions) : { materials: false, project: false, external: false };
      const collaboration = teamConfigurationSchema.parse(request.collaboration ?? {});
      if (collaboration.mode !== "single") {
        if (session.study) throw new Error("team_study_unavailable");
        const previous = request.resumeTaskId ? session.messages.slice(0, -2).findLast(item => item.taskId === message.taskId && item.steerId === message.steerId)?.team : undefined;
        this.activeTeam = await TeamCoordinator.create({ config: collaboration, provider: request.provider, resolve: provider => this.client(provider), reasoning: message.reasoning ?? "balanced", question: request.text, images: request.images, retryTaskId: request.retryTeamTaskId,
          scope: { sessionId: session.id, topicId: session.topicId, permissions: session.permissions, contextAllowed: session.contextAllowed }, previous,
          save: async team => { message.team = team; await this.store.save(session); this.patch(session, { team }); },
        }, signal);
      }
      const taskClient = this.activeTeam?.client ?? client;
      const dialogue = restrictedStudy(session.study) ? { messages: [] } : await prepareDialogue(this.learning, session, request, async prompt => {
        if (isAgentExecutor(taskClient)) return (await executeAgent(taskClient, { prompt, maxOutputChars: 2000 }, signal)).text;
        const result = await collectInvocation(providerRuntime(request.provider, taskClient), { role: "tutor", providerId: request.provider, prompt,
          containsUserMaterials: true, confirmed: true, allowFallback: false, requireDone: true, limits: { maxTurns: 1, maxOutputChars: 2000 }, onAudit: observer?.onAudit }, signal);
        if (result.partial) throw new Error("provider_incomplete");
        return result.text;
      });
      const messages = buildMessages({ ...session, messages: session.messages.slice(0, -2) }, request);
      messages.splice(Math.max(0, messages.length - 1), 0, ...dialogue.messages);
      const prompt = messages.map(item => `${item.role}: ${item.content}`).join("\n\n");
      const taskOptions: Parameters<typeof runAssistantTask>[0] = {
        runId: message.id, providerId: request.provider, client: taskClient, prompt, question: request.text,
        messages, teaching: session.teaching ?? null, structured: dialogue.structured, onAudit: observer?.onAudit, onTool: observer?.onTool,
        conversationHistory: restrictedStudy(session.study) ? undefined : session.messages.slice(0, -2),
        taskId: message.taskId, sessionId: session.id, resumeInput: request.resumeTaskId ? request.text : undefined, steerId: request.steerId, allowWrites: request.execution === "once" || session.executionAllowed === true,
        reasoning: message.reasoning, permissions: session.permissions, writeGrants: session.writeGrants,
        onTiming: (timing) => { (message.modelTimings ??= []).push(timing); },
        onContext: (usage) => { message.contextUsage = usage; },
        onEvidenceSupport: (report) => { message.evidenceSupport = report; },
        onItem: (item) => { if (item.kind !== "artifact" || !session.messages.some(entry => entry.items?.some(previous => previous.kind === "artifact" && previous.artifactId === item.artifactId))) (message.items ??= []).push(item); this.patch(session, { items: message.items }); },
        onInteraction: restrictedStudy(session.study) ? undefined : async (item) => { const existing = session.messages.flatMap(entry => entry.items ?? []).find(entry => (entry.kind === "question" || entry.kind === "approval") && entry.id === item.id && entry.status === "pending");
          if (!existing) (message.items ??= []).push(item); await this.store.save(session); this.patch(session, { items: message.items }); },
        onTurn: (text, kind) => {
          display(continuation.finish());
          text = continuation.clean(text); removedRepeat += continuation.removed;
          text = normalizeDisplayMath(text);
          continuation = new ContinuationText();
          if (text) (message.items ??= []).push({ id: randomUUID(), kind, text });
          message.text = kind === "final" ? text : "";
          this.patch(session, { text: message.text, items: message.items });
        },
        onUsage: (usage) => {
          message.model = usage.model ?? message.model;
          const previous = message.usage;
          const sumKnown = (before: number | undefined, current: number | undefined) => current === undefined || previous && before === undefined ? undefined : (before ?? 0) + current;
          message.usage = { inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens, outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens, cacheReadTokens: sumKnown(previous?.cacheReadTokens, usage.cacheReadTokens), reasoningTokens: sumKnown(previous?.reasoningTokens, usage.reasoningTokens), startupMs: sumKnown(previous?.startupMs, usage.startupMs) };
        },
        application: restrictedStudy(session.study) ? undefined : this.learning, topicId: restrictedStudy(session.study) ? undefined : session.topicId, contextAllowed: session.contextAllowed ?? false,
        onText: (text) => {
          display(continuation.push(text));
          if (Date.now() - savedAt > 750) {
            savedAt = Date.now();
            void this.store.save(session).catch(() => { mayDrain = false; session.queuePaused = true; });
          }
        },
        onActivity: (activity, key) => {
          message.activities ??= [];
          const index = activities.get(key);
          if (index !== undefined) message.activities[index] = activity;
          else { activities.set(key, message.activities.length); message.activities.push(activity); }
          this.patch(session, { activities: message.activities });
        },
        onCitation: (citation) => {
          message.citations ??= [];
          if (message.citations.length < 24 && !message.citations.some((item) => JSON.stringify(item) === JSON.stringify(citation))) message.citations.push(citation);
        },
        onCandidate: (citation) => { (message.retrievedCitations ??= []).push(citation); },
      };
      message.profile = "application";
      let result: Awaited<ReturnType<typeof runAssistantTask>>;
      if (dialogue.local !== undefined) {
        display(dialogue.local);
        await this.activeTeam?.settleLocal();
        result = { contextMs: 0, modelMs: 0, toolMs: 0, turns: 0, toolCalls: 0, waiting: false };
      } else {
        result = this.activeTeam ? await this.activeTeam.run(taskOptions, signal) : await runAssistantTask(taskOptions, signal);
        signal.throwIfAborted();
        if (!result.waiting && !result.blocked) await dialogue.finish?.(message.text);
      }
      message.timings = result;
      message.timings.compactionMs = 0;
      message.status = result.waiting ? "waiting" : result.blocked ? "blocked" : "completed";
      if (result.waiting || result.blocked) session.queuePaused = true;
    } catch (error) {
      const cancellationUnknown = error instanceof Error && error.message === "native_cancel_unconfirmed";
      message.status = cancellationUnknown ? "blocked" : controller.signal.aborted ? "interrupted" : "failed";
      try { await this.activeTeam?.settleFailure(signal); } catch { mayDrain = false; }
      if (message.status === "failed" || cancellationUnknown) {
        message.error = timeout.aborted ? "等待回答超时，请重试。" : publicError(error);
        session.queuePaused = true;
      }
    } finally {
      display(continuation.finish()); removedRepeat += continuation.removed;
      message.quality = inspectResponse(message.text, request.text, (message.citations ?? []).map(citationMarker));
      if (removedRepeat) message.quality.unshift({ code: "continuation_repeat_removed", detail: `已省略续写开头与上一条中断回答完全相同的 ${removedRepeat} 个字符。` });
      controller.abort();
      this.activeTeam = undefined;
      await Promise.allSettled([...this.pendingEnqueues]);
      message.durationMs = Date.now() - started;
      session.updatedAt = new Date().toISOString();
      this.reconcileSupersededInteractions(session);
      try { await this.store.save(session); }
      catch {
        mayDrain = false;
        message.status = "failed";
        message.error = "本地保存失败，请先复制当前回答，再检查磁盘空间。";
      }
      releaseSession?.();
      this.active = null;
      this.emit({ type: "session", session });
      this.emit({ type: "settled", sessionId: session.id });
      if (mayDrain && !session.study && message.status === "completed" && !session.pendingRequests?.length) {
        const background = new AbortController(); this.maintenanceController = background;
        const snapshot = structuredClone(session); const compactStarted = Date.now();
        this.maintenance = this.compact(snapshot, client, request.provider, background.signal).then(async () => {
          background.signal.throwIfAborted();
          // New input cancels this work before loading history; stale snapshots cannot overwrite it.
          if (snapshot.context?.lastAttemptId === session.context?.lastAttemptId) return;
          await this.withStoredSession(session.id, async current => {
            background.signal.throwIfAborted();
            if (current.messages.at(-1)?.id !== session.messages.at(-1)?.id || current.context?.goal !== session.context?.goal || current.context?.notes !== session.context?.notes) return;
            current.context = { ...current.context!, summary: snapshot.context?.summary, summaryThroughId: snapshot.context?.summaryThroughId,
              summarySourceHash: snapshot.context?.summarySourceHash, summaryAttemptFailed: snapshot.context?.summaryAttemptFailed, lastAttemptId: snapshot.context?.lastAttemptId };
            current.messages.at(-1)!.timings!.compactionMs = Date.now() - compactStarted;
            await this.store.save(current);
            this.emit({ type: "session", session: current });
          });
        }).catch(() => { /* Optional maintenance never turns a completed answer into a failed task. */ });
      }
      if (mayDrain) await this.drain(session);
    }
  }
}

function isolateObserver(observer?: AgentObserver): AgentObserver | undefined {
  if (!observer) return undefined;
  const shield = <Args extends unknown[]>(listener?: (...args: Args) => void | Promise<void>) => listener ? async (...args: Args) => {
    try { await listener(...args); } catch { /* Output and telemetry are not execution policy. */ }
  } : undefined;
  return { signal: observer.signal, onText: shield(observer.onText), onAudit: shield(observer.onAudit), onTool: shield(observer.onTool) };
}
