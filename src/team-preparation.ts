import { abortable } from "./abortable.js";
import type { AgentBackend } from "./agent-executor.js";
import type { TeamSnapshot } from "./team-contracts.js";
import { teamFailure, teamFailureLabels } from "./team-quality.js";

/** Preparation is a connection boundary, not a model turn or an all-member success gate. */
export async function prepareTeamConnections(state: TeamSnapshot, lead: AgentBackend, members: AgentBackend[], save: () => Promise<void>, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  const clients = new Map([[state.lead.provider, lead], ...members.flatMap((client, index) => state.members[index]?.status === "queued" ? [[state.members[index]!.binding.provider, client] as const] : [])]);
  state.connections = [...clients.keys()].map(provider => ({ provider, status: "preparing" }));
  await save();
  const results = await Promise.allSettled(state.connections.map(async connection => {
    const began = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Connection preparation timed out", "TimeoutError")), 30_000);
    const preparationSignal = AbortSignal.any([signal, timeout.signal]);
    try {
      await abortable(async () => clients.get(connection.provider)!.prepare?.(preparationSignal), preparationSignal);
      signal.throwIfAborted(); connection.status = "ready";
    } catch (error) {
      connection.status = signal.aborted ? "interrupted" : "failed";
      connection.failureCode = teamFailure(error, preparationSignal);
      for (const member of state.members) if (member.binding.provider === connection.provider && member.status === "queued") {
        member.status = signal.aborted ? "cancelled" : "failed";
        member.failureCode = connection.failureCode;
        member.error = teamFailureLabels[connection.failureCode];
      }
    } finally { clearTimeout(timer); }
    connection.durationMs = Date.now() - began;
    await save();
  }));
  // A durable state failure stops dispatch even if every model connection is healthy.
  const failedSave = results.find(result => result.status === "rejected");
  if (failedSave?.status === "rejected") throw failedSave.reason;
  signal.throwIfAborted(); state.preparationMs = Date.now() - started;
  await save();
  if (state.connections.find(connection => connection.provider === state.lead.provider)?.status !== "ready") throw new Error("provider_unavailable");
}
