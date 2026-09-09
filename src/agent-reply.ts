import type { ChatMessage } from "./agent-session-contracts.js";

/** Application reply, distinct from the lower-level provider invocation event stream. */
export interface AgentReply {
  team?: ChatMessage["team"];
  text: string; finalText: string; providerId: string; messageId: string; taskId?: string;
  waiting: boolean; blocked: boolean; partial?: boolean; stopReason?: string;
  statistics: { modelTurns: number | null; toolCalls: number | null; eventCount: null; source: "persisted_message"; toolResultSource: "execution_history" };
}
export function agentReply(message: ChatMessage, providerId: string): AgentReply {
  return { text: message.text, finalText: message.text, providerId, messageId: message.id, taskId: message.taskId, team: message.team,
    waiting: message.status === "waiting", blocked: message.status === "blocked",
    statistics: { modelTurns: message.timings?.turns ?? null, toolCalls: message.timings?.toolCalls ?? null, eventCount: null, source: "persisted_message", toolResultSource: "execution_history" },
    ...(message.status === "failed" ? { partial: true, stopReason: "provider_incomplete" } : {}) };
}
