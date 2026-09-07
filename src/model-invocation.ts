import type { ModelEvent, ModelMessage, ModelRole, ModelToolDefinition, ModelTurn, ModelUsage, ReasoningProfile, ToolResultMessage } from "./model.js";
import { assertExternalContentAllowed } from "./external-content-gate.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { createModelAudit, type ModelAuditRecord } from "./model-audit.js";
import { AgentLoop } from "./agent-loop.js";
import { abortable } from "./abortable.js";
import type { ModelPhase, ModelTiming } from "./model-telemetry.js";
import { randomUUID } from "node:crypto";
import type { AgentExecutionStore, ExecutionCheckpoint } from "./agent-execution-store.js";

/** Runtime-enforced resource bounds; these values never come from model output. */
export interface InvocationLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxEvents: number;
  readonly maxOutputChars: number;
  readonly maxContextChars: number;
  readonly timeoutMs: number;
}
const DEFAULT_LIMITS: InvocationLimits = { maxTurns: 6, maxToolCalls: 32, maxEvents: 10_000, maxOutputChars: 64_000, maxContextChars: 128_000, timeoutMs: 180_000 };

export interface InvocationRequest {
  readonly role: ModelRole;
  readonly prompt: string;
  readonly messages?: readonly ModelMessage[];
  readonly reasoning?: ReasoningProfile;
  readonly onUsage?: (usage: ModelUsage) => void;
  readonly onProgress?: (phase: ModelPhase) => void;
  readonly onTiming?: (timing: ModelTiming) => void;
  readonly onTurn?: (text: string, kind: "progress" | "final") => void;
  readonly shouldPause?: () => boolean;
  /** Actual application revisions, not a model-supplied claim of progress. */
  readonly toolState?: () => string;
  /** Missing execution requirements; undefined means no unfinished plan. */
  readonly completionCheck?: (signal: AbortSignal) => string | undefined | Promise<string | undefined>;
  readonly execution?: AgentExecutionStore;
  readonly resumeInput?: string;
  /** Durable identity of a user correction; reapplying the same correction is a no-op. */
  readonly steerId?: string;
  readonly materialContext?: boolean;
  readonly canReplayTool?: (name: string) => boolean;
  readonly providerId: string;
  readonly containsUserMaterials: boolean;
  readonly confirmed: boolean;
  /** Synchronous return values are ignored; Promise returns preserve trace ordering. */
  readonly onAudit?: (record: ModelAuditRecord) => unknown | Promise<unknown>;
  readonly onText?: (text: string, providerId: string) => void;
  readonly onToolCall?: (tool: string, input: unknown, signal: AbortSignal, callId?: string) => Promise<unknown>;
  readonly onToolResult?: (tool: string, result: unknown) => void;
  readonly allowFallback?: boolean;
  readonly tools?: readonly ModelToolDefinition[];
  readonly limits?: Partial<InvocationLimits>;
  readonly requireDone?: boolean;
}

/** A partial result is never a successful completion of the requested task. */
export interface InvocationResult {
  readonly blocked?: boolean;
  readonly waiting?: boolean;
  readonly finalText?: string;
  readonly text: string;
  readonly events: number;
  readonly providerId: string;
  readonly toolResults: ToolResultMessage[];
  readonly partial?: boolean;
  readonly stopReason?: string;
}

/** One bounded invocation, optionally resumed from a canonical execution journal. */
export async function collectInvocation(runtime: ProviderRuntime, request: InvocationRequest, parent: AbortSignal): Promise<InvocationResult> {
  assertExternalContentAllowed(request);
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error("invocation_limits_invalid");
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("invocation_timeout")), limits.timeoutMs);
  const signal = AbortSignal.any([parent, controller.signal]);
  const providers = runtime.forInvocation(request.role);
  let text = ""; let finalText = ""; let partialText = "";
  let savedTextAt = 0;
  let events = 0; let turns = 0; let toolCalls = 0;
  let actualProviderId = request.providerId;
  let failure: unknown; let stopReason: string | undefined;
  let waiting = false; let blocked = false; let completionAttempts = 0;
  const toolResults: ToolResultMessage[] = [];
  const loop = new AgentLoop(limits.maxTurns);
  const callIds = new Set<string>();
  let release: (() => void) | undefined;
  let started = false;
  let checkpoint: ExecutionCheckpoint = { version: 1, status: "running", prompt: request.prompt, messages: request.messages ? [...request.messages] : undefined, history: [], decisions: {}, containsMaterials: request.materialContext ?? false };
  const save = (type: string, callId?: string) => request.execution?.save(checkpoint, type, callId);
  const checkCompletion = async () => {
    const result = await abortable(async () => request.completionCheck?.(signal), signal);
    signal.throwIfAborted();
    return result;
  };
  try {
    release = request.execution?.claim();
    const previousCheckpoint = request.execution?.read();
    let steered = false;
    if (!previousCheckpoint) checkpoint.steerId = request.steerId;
    if (previousCheckpoint) {
      if (previousCheckpoint.containsMaterials && !request.materialContext) throw new Error("execution_context_required");
      checkpoint = previousCheckpoint;
      const feedback = [request.resumeInput, checkpoint.partialText ? `已展示但未完成的回答片段（不能作为完成证据，请避免重复）：${checkpoint.partialText}` : undefined].filter(Boolean).join("\n");
      if (feedback) {
        const target = checkpoint.pending ?? checkpoint.history.at(-1);
        if (target) {
          const updated = { ...target, feedback: [target.feedback, feedback].filter(Boolean).join("\n").slice(-24_000) };
          if (checkpoint.pending) checkpoint.pending = updated as NonNullable<ExecutionCheckpoint["pending"]>;
          else checkpoint.history[checkpoint.history.length - 1] = updated;
        } else if (checkpoint.messages) checkpoint.messages.push({ role: "user", content: feedback });
        else checkpoint.prompt += `\n${feedback}`;
      }
      checkpoint.partialText = undefined;
      if (request.steerId && request.steerId !== checkpoint.steerId) {
        const pending = checkpoint.pending;
        if (pending) {
          const calls = pending.events.filter(event => event.type === "tool_call");
          if (pending.phase === "executing" && calls[pending.next] && !request.canReplayTool?.(calls[pending.next]!.tool!)) throw new Error("tool_recovery_required");
          const cancelled = calls.slice(pending.next).map((call, index): ToolResultMessage => ({ tool: call.tool!, callId: call.callId, dispatch: pending.phase === "executing" && index === 0 ? "unknown" : "not_started", result: {
            ok: false, errorCode: pending.phase === "executing" && index === 0 ? "tool_interrupted" : "tool_superseded", outcome: pending.phase === "executing" && index === 0 ? "unknown" : "not_started",
          } }));
          checkpoint.history.push({ events: pending.events, toolResults: [...pending.toolResults, ...cancelled], feedback: pending.feedback, toolState: pending.toolState });
          checkpoint.pending = undefined; toolResults.push(...cancelled);
        }
        checkpoint.steerId = request.steerId; steered = true;
      }
      for (const turn of [...checkpoint.history, ...(checkpoint.pending ? [checkpoint.pending] : [])]) {
        const calls = turn.events.filter(event => event.type === "tool_call");
        for (const [index, event] of calls.entries()) {
          // Only runtime metadata can exclude an unstarted call; a tool payload cannot bypass the guard.
          const result = turn.toolResults[index];
          if (!request.resumeInput && result && result.dispatch !== "not_started") loop.tool(event.tool!, event.input, result.toolState ?? turn.toolState);
          if (event.callId) callIds.add(event.callId);
        }
      }
    }
    checkpoint.status = "running"; save(steered ? "steered" : previousCheckpoint ? "resumed" : "started"); started = true;
    // Restored work consumes this invocation's budget; completed results are not dispatched again.
    toolCalls = checkpoint.pending ? checkpoint.pending.events.filter(event => event.type === "tool_call").length - checkpoint.pending.next : 0;
    const checkpointContextChars = () => (checkpoint.messages ? JSON.stringify(checkpoint.messages).length : checkpoint.prompt.length) + JSON.stringify(request.tools ?? []).length + JSON.stringify(checkpoint.history).length + (checkpoint.pending ? JSON.stringify(checkpoint.pending).length : 0);
    let contextChars = checkpointContextChars();
    for (;;) {
      signal.throwIfAborted();
      if (toolCalls > limits.maxToolCalls) throw new Error("max_tool_calls");
      contextChars = Math.max(contextChars, checkpointContextChars());
      if (contextChars > limits.maxContextChars) throw new Error("model_input_limit");
      // A validated pending batch is dispatched before another model request.
      if (checkpoint.pending) {
        const pending = checkpoint.pending;
        const calls = pending.events.filter(event => event.type === "tool_call");
        if (pending.phase === "executing" && calls[pending.next] && !request.canReplayTool?.(calls[pending.next]!.tool!)) throw new Error("tool_recovery_required");
        const results = [...pending.toolResults];
        while (pending.next < calls.length) {
          signal.throwIfAborted();
          if (Math.max(contextChars, checkpointContextChars()) > limits.maxContextChars) throw new Error("model_input_limit");
          const call = calls[pending.next]!;
          if (!request.onToolCall) throw new Error("tool_dispatcher_required");
          const dispatchState = request.toolState?.() ?? "";
          const duplicate = loop.tool(call.tool!, call.input, dispatchState); if (duplicate) throw new Error(duplicate);
          pending.phase = "executing"; checkpoint.pending = { ...pending, toolResults: results }; save("tool_started", call.callId);
          let result: unknown;
          if (request.tools && !request.tools.some(tool => tool.name === call.tool)) result = { ok: false, errorCode: "tool_not_allowed" };
          else {
            try { result = await abortable(() => request.onToolCall!(call.tool!, call.input, signal, call.callId), signal); }
            catch (error) { if (signal.aborted) throw error; result = { ok: false, errorCode: "tool_failed" }; }
          }
          if (request.shouldPause?.()) {
            waiting = true; pending.phase = "waiting"; checkpoint.status = "waiting"; checkpoint.pending = { ...pending, toolResults: results }; save("waiting", call.callId); break;
          }
          const serialized = JSON.stringify(result ?? null);
          if (serialized === undefined) throw new Error("tool_output_invalid");
          const bounded = serialized.length > 12_000 ? { truncated: true, preview: serialized.slice(0, 12_000) } : result ?? null;
          const message: ToolResultMessage = { tool: call.tool!, result: bounded, ...(call.callId ? { callId: call.callId } : {}), ...(request.toolState ? { toolState: dispatchState } : {}) };
          results.push(message); toolResults.push(message); contextChars += JSON.stringify(bounded).length;
          pending.next++; pending.phase = "ready";
          checkpoint.pending = { ...pending, toolResults: results };
          // Persist a real result before notifying consumers, which may cancel us.
          save("tool_completed", call.callId);
          request.onToolResult?.(message.tool, message.result);
          signal.throwIfAborted();
        }
        if (waiting) break;
        checkpoint.history.push({ events: pending.events, toolResults: results, toolState: pending.toolState, feedback: pending.feedback });
        checkpoint.pending = undefined;
        if (pending.toolState !== (request.toolState?.() ?? "")) completionAttempts = 0;
        save("tools_completed");
      }
      if (turns >= limits.maxTurns) throw new Error("max_turns");
      if (contextChars > limits.maxContextChars) throw new Error("model_input_limit");
      const previous = checkpoint.history.at(-1);
      const toolState = request.toolState?.() ?? "";
      const holdText = Boolean(await checkCompletion());
      const options = { tools: request.tools, history: checkpoint.history, messages: checkpoint.messages, reasoning: request.reasoning };
      const onProvider = (id: string) => { actualProviderId = id; };
      let stream = previous
        ? providers.continue(request.role, checkpoint.prompt, previous.toolResults, signal, onProvider, options)
        : providers.stream(request.role, checkpoint.prompt, signal, onProvider, request.allowFallback ?? true, options);
      if (!stream && previous && !checkpoint.history.some(turn => turn.events.some(event => event.type === "tool_call"))) {
        const transcript = checkpoint.history.map(turn => `${turn.events.filter(event => event.type === "text_delta").map(event => event.text ?? "").join("")}\n${turn.feedback ?? ""}`).join("\n");
        stream = providers.stream(request.role, `${checkpoint.prompt}\n${transcript}`, signal, onProvider, request.allowFallback ?? true, options);
      }
      if (!stream) { stopReason = "provider_continuation_unsupported"; break; }
      const stop = loop.turn(); if (stop) throw new Error(stop);
      turns++; partialText = ""; save("model_requested");
      const turnEvents: ModelEvent[] = []; const calls: ModelEvent[] = [];
      const iterator = stream[Symbol.asyncIterator](); let completed = false;
      try {
        for (;;) {
          const next = await abortable(() => iterator.next(), signal); if (next.done) break;
          signal.throwIfAborted();
          let event = next.value;
          if (++events > limits.maxEvents) throw new Error("model_event_limit");
          if (event.type === "done") { completed = true; break; }
          if (event.type === "tool_result") throw new Error("untrusted_tool_result");
          if (event.type === "progress") { if (event.phase) request.onProgress?.(event.phase); continue; }
          if (event.type === "timing") { if (event.timing) request.onTiming?.(event.timing); continue; }
          if (event.type === "text_delta") {
            if (typeof event.text !== "string") continue;
            if (text.length + event.text.length > limits.maxOutputChars) throw new Error("model_output_limit");
            text += event.text; partialText += event.text; contextChars += event.text.length;
            if (request.execution && Date.now() - savedTextAt >= 750) { checkpoint.partialText = partialText; save("text_checkpoint"); savedTextAt = Date.now(); }
            if (!holdText) request.onText?.(event.text, actualProviderId);
          } else if (event.type === "usage") {
            if (event.usage) request.onUsage?.(event.usage);
          } else if (event.type === "provider_state") contextChars += JSON.stringify(event.result ?? null).length;
          else if (event.type === "tool_call") {
            if (!request.onToolCall) throw new Error("tool_dispatcher_required");
            if (!event.tool) throw new Error("provider_protocol_error");
            if (++toolCalls > limits.maxToolCalls) throw new Error("max_tool_calls");
            if (event.callId && callIds.has(event.callId)) throw new Error("provider_protocol_error");
            if (request.execution && !event.callId) event = { ...event, callId: randomUUID() };
            if (event.callId) callIds.add(event.callId);
            contextChars += JSON.stringify(event.input ?? null).length; calls.push(event);
          }
          if (contextChars > limits.maxContextChars) throw new Error("model_input_limit");
          turnEvents.push(event);
        }
      } finally {
        if (signal.aborted) void iterator.return?.().catch(() => undefined);
        else if (iterator.return) await abortable(() => iterator.return!(), signal);
      }
      if (request.requireDone && !completed) throw new Error("provider_incomplete");
      checkpoint.partialText = undefined;
      const turnText = turnEvents.filter(event => event.type === "text_delta").map(event => event.text ?? "").join("");
      const turn: ModelTurn = { events: turnEvents, toolResults: [], toolState };
      const unfinished = !calls.length ? await checkCompletion() : undefined;
      if (unfinished) {
        if (++completionAttempts >= 2) {
          blocked = true; stopReason = "task_incomplete"; checkpoint.status = "blocked";
          finalText = `任务尚未完成：${unfinished}。连续检查仍未取得所需结果，请补充信息或重试。`;
          text = finalText; checkpoint.history.push({ ...turn, events: [{ type: "text_delta", text: finalText }] }); save("blocked");
          request.onText?.(finalText, actualProviderId); request.onTurn?.(finalText, "final"); break;
        }
        checkpoint.history.push({ ...turn, feedback: `应用完成检查：${unfinished}。请继续实际执行；不能仅以文字声明完成。确实缺少信息时调用 ask_user。` }); save("completion_rejected");
        continue;
      }
      if (calls.length) {
        checkpoint.pending = { ...turn, next: 0, phase: "ready" }; save("turn_validated");
      } else {
        finalText = turnText; checkpoint.history.push(turn); checkpoint.status = "completed"; save("completed");
      }
      partialText = "";
      if (holdText && turnText) request.onText?.(turnText, actualProviderId);
      request.onTurn?.(turnText, calls.length ? "progress" : "final");
      if (!calls.length) break;
    }
    signal.throwIfAborted();
  } catch (error) {
    failure = parent.aborted ? new DOMException("cancelled", "AbortError") : controller.signal.aborted ? new Error("invocation_timeout") : error;
    if (release && started) {
      checkpoint.status = parent.aborted ? "interrupted" : "failed";
      checkpoint.partialText = partialText || undefined;
      try { save(checkpoint.status); } catch { /* Preserve the failure; no further execution is allowed. */ }
    }
    const code = failure instanceof Error ? failure.message.split(":", 1)[0] : "";
    if (!parent.aborted && text.trim() && ["provider_timeout", "provider_incomplete", "invocation_timeout"].includes(code ?? "")) { stopReason = code; failure = undefined; }
  } finally { clearTimeout(timer); release?.(); }
  await request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, parent.aborted ? "cancelled" : failure || stopReason ? "error" : "success", { events, turns, toolCalls }));
  if (failure) throw failure;
  return { text, finalText, waiting, events, providerId: actualProviderId, toolResults, ...(blocked ? { blocked: true, stopReason } : stopReason ? { partial: true, stopReason } : {}) };
}
