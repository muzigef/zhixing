import type { ModelRole, ToolResultMessage } from "./model.js";
import { assertExternalContentAllowed } from "./external-content-gate.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { createModelAudit, type ModelAuditRecord } from "./model-audit.js";
import { AgentLoop } from "./agent-loop.js";

export interface InvocationRequest {
  readonly role: ModelRole;
  readonly prompt: string;
  readonly providerId: string;
  readonly containsUserMaterials: boolean;
  readonly confirmed: boolean;
  /** Synchronous return values are ignored; Promise returns are awaited for trace ordering. */
  readonly onAudit?: (record: ModelAuditRecord) => unknown | Promise<unknown>;
  readonly onText?: (text: string, providerId: string) => void;
  readonly onToolCall?: (tool: string, input: unknown) => Promise<unknown>;
  readonly onToolResult?: (tool: string, result: unknown) => void;
  /** Explicit provider interactions must surface a provider error instead of silently changing speakers. */
  readonly allowFallback?: boolean;
}

/** Adds consent gating to role-routed model calls without exposing source documents by default. */
export async function collectInvocation(runtime: ProviderRuntime, request: InvocationRequest, signal: AbortSignal): Promise<{ text: string; events: number; providerId: string; toolResults: Array<{ tool: string; result: unknown }>; partial?: boolean }> {
  assertExternalContentAllowed(request);
  const startedAt = Date.now();
  let text = "";
  let events = 0;
  let actualProviderId = request.providerId;
  const toolResults: Array<{ tool: string; result: unknown }> = [];
  let turns = 0;
  const loop = new AgentLoop();
  try {
    let continuation: readonly ToolResultMessage[] | undefined;
    for (;;) {
      turns += 1;
      const stop = loop.turn();
      if (stop) throw new Error(stop);
      const stream = continuation
        ? runtime.continue(request.role, request.prompt, continuation, signal, (providerId) => { actualProviderId = providerId; })
        : runtime.stream(request.role, request.prompt, signal, (providerId) => { actualProviderId = providerId; }, request.allowFallback ?? true);
      // Existing text-only adapters deliberately end after a tool result; they
      // cannot be tricked into an unsupported second model request.
      if (!stream) break;
      const turnResults: ToolResultMessage[] = [];
      for await (const event of stream) {
      events += 1;
      if (event.type === "text_delta") { text += event.text ?? ""; if (event.text) request.onText?.(event.text, actualProviderId); }
        if (event.type === "tool_call") {
        if (!request.onToolCall) throw new Error("tool_dispatcher_required");
        const duplicate = loop.tool(event.tool ?? "", event.input);
        if (duplicate) throw new Error(duplicate);
        const result = await request.onToolCall(event.tool ?? "", event.input);
        const toolResult: ToolResultMessage = { tool: event.tool ?? "", result };
        toolResults.push(toolResult);
        turnResults.push(toolResult);
        request.onToolResult?.(toolResult.tool, result);
      }
        if (event.type === "tool_result") {
        const toolResult: ToolResultMessage = { tool: event.tool ?? "", result: event.result };
        toolResults.push(toolResult);
        request.onToolResult?.(toolResult.tool, toolResult.result);
      }
      }
      if (turnResults.length === 0) break;
      continuation = turnResults;
    }
    await request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, "success", { events, turns, toolCalls: toolResults.length }));
    return { text, events, providerId: actualProviderId, toolResults };
  } catch (error) {
    await request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, signal.aborted ? "cancelled" : "error", { events, turns, toolCalls: toolResults.length }));
    // Preserve streamed teaching content if the provider stalls after it has
    // already started responding. The caller can label it as incomplete.
    if (text.trim() && error instanceof Error && error.message.startsWith("provider_timeout")) return { text, events, providerId: actualProviderId, toolResults, partial: true };
    throw error;
  }
}
