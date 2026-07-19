import type { TopicId } from "./contracts.js";
import { AuditLogger, AuditRun } from "./audit.js";

/** Owns one CLI request lifecycle and keeps model metadata on the same audit run. */
export class RunContext {
  readonly audit: AuditRun;
  constructor(logger: AuditLogger, readonly topicId: TopicId, readonly command: string) { this.audit = logger.createRun(topicId, command); }
  start(): Promise<void> { return this.audit.start(); }
  finish(message?: string): Promise<void> { return this.audit.finish(message); }
  fail(message: string): Promise<void> { return this.audit.fail(message); }
  cancel(message?: string): Promise<void> { return this.audit.cancel(message); }
  tool(tool: string, phase: "started" | "progress" | "finished" | "failed"): Promise<void> { return this.audit.tool(tool, phase); }
  model(providerId: string, role: string, durationMs: number, status: string, trace?: { events: number; turns: number; toolCalls: number }): Promise<void> { return this.audit.model(providerId, role, durationMs, status, trace); }
  get runId(): string { return this.audit.runId; }
}
