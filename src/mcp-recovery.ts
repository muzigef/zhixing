import { McpSettings, mcpAlias } from "./mcp-settings.js";
import { McpConnection } from "./mcp-connection.js";
import type { ZhixingDatabase } from "./database.js";
import type { ExecutionIdentity } from "./agent-execution-store.js";
import { TaskContinuity } from "./task-continuity.js";

/** Explicit read-only reconciliation with a configured service contract and exact operation identity. */
export async function verifyMcpRecovery(database: ZhixingDatabase, identity: ExecutionIdentity, callId: string, signal: AbortSignal) {
  const continuity = new TaskContinuity(database); const call = continuity.inspect(identity).recovery;
  if (!call || call.callId !== callId) throw new Error("recovery_conflict");
  const settings = new McpSettings(database); const configuration = settings.read(identity.topicId);
  const candidates = configuration.servers.filter(server => server.enabled).flatMap(server => server.tools.filter(policy => policy.risk === "write" && policy.reconcile && call.tool.startsWith(`mcp_${server.id}_${policy.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 16)}_`)).map(policy => ({ server, policy })));
  if (candidates.length !== 1) throw new Error("recovery_verifier_unavailable");
  const { server, policy } = candidates[0]!; const rule = policy.reconcile!;
  if (!server.tools.some(tool => tool.name === rule.tool && tool.risk === "read" && tool.replaySafe)) throw new Error("recovery_verifier_unavailable");
  const connection = await McpConnection.open(server, signal);
  try {
    const original = connection.tools.find(tool => tool.name === policy.name);
    if (!original || mcpAlias(server, original.name, original.inputSchema) !== call.tool) throw new Error("mcp_configuration_changed");
    const reference = (call.input as Record<string, unknown> | null)?.[rule.identity];
    if (typeof reference !== "string" && typeof reference !== "number") throw new Error("recovery_identity_missing");
    const input = { [rule.argument]: reference }; await connection.validate(rule.tool, input, signal);
    const response = await connection.call(rule.tool, input, signal);
    const result = (response as { structuredContent?: Record<string, unknown> }).structuredContent;
    signal.throwIfAborted();
    if (settings.read(identity.topicId).revision !== configuration.revision) throw new Error("mcp_configuration_changed");
    if (!result || result[rule.resultIdentity] !== reference) throw new Error("recovery_identity_mismatch");
    const status = result[rule.status];
    if (status !== rule.succeeded && status !== rule.notExecuted) throw new Error("recovery_still_unknown");
    const succeeded = status === rule.succeeded;
    continuity.resolve(identity, callId, { ok: succeeded, recovery: true, verified: true, source: "external_query", outcome: succeeded ? "succeeded" : "not_executed", originalResponse: "unavailable", verification: { server: server.id, tool: rule.tool, reference, status } });
    return continuity.inspect(identity);
  } finally { await connection.close(); }
}
