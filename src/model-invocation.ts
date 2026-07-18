import type { ModelRole } from "./model.js";
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
  readonly onAudit?: (record: ModelAuditRecord) => void;
  readonly onToolCall?: (tool: string, input: unknown) => Promise<unknown>;
}

/** Adds consent gating to role-routed model calls without exposing source documents by default. */
export async function collectInvocation(runtime: ProviderRuntime, request: InvocationRequest, signal: AbortSignal): Promise<{ text: string; events: number }> {
  assertExternalContentAllowed(request);
  const startedAt = Date.now();
  let text = "";
  let events = 0;
  let actualProviderId = request.providerId;
  const loop = new AgentLoop();
  try {
    for await (const event of runtime.stream(request.role, request.prompt, signal, (providerId) => { actualProviderId = providerId; })) {
      const stop = loop.turn();
      if (stop) throw new Error(stop);
      events += 1;
      if (event.type === "text_delta") text += event.text ?? "";
      if (event.type === "tool_call") {
        if (!request.onToolCall) throw new Error("tool_dispatcher_required");
        await request.onToolCall(event.tool ?? "", event.input);
      }
    }
    request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, "success"));
    return { text, events };
  } catch (error) {
    request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, signal.aborted ? "cancelled" : "error"));
    throw error;
  }
}
