import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export interface AuditEvent {
  readonly runId: string;
  readonly topicId: TopicId;
  readonly seq: number;
  readonly type: "run_started" | "run_finished" | "run_failed" | "run_cancelled" | "tool_started" | "tool_progress" | "tool_finished" | "tool_failed" | "model_invoked";
  readonly command: string;
  readonly message?: string;
  readonly at: string;
}

/** Appends privacy-safe lifecycle records without exposing user prompts or tool payloads. */
export class AuditLogger {
  constructor(private readonly paths: PathPolicy, private readonly now: () => Date = () => new Date()) {}

  async appendTool(topicId: TopicId, runId: string, seq: number, tool: string, phase: "started" | "progress" | "finished" | "failed"): Promise<void> {
    await this.append({ runId, topicId, seq, type: `tool_${phase}` as AuditEvent["type"], command: `tool:${tool}`, at: this.now().toISOString() });
  }

  async appendModel(topicId: TopicId, runId: string, seq: number, providerId: string, role: string, durationMs: number, status: string, trace?: { events: number; turns: number; toolCalls: number }): Promise<void> {
    const suffix = trace ? `;events=${trace.events};turns=${trace.turns};toolCalls=${trace.toolCalls}` : "";
    const event: AuditEvent = { runId, topicId, seq, type: "model_invoked", command: `model:${providerId}:${role}`, message: `durationMs=${durationMs};status=${status}${suffix}`, at: this.now().toISOString() };
    await this.append(event);
  }

  async append(event: AuditEvent): Promise<void> {
    const file = this.paths.resolveTopicPath(event.topicId, "audit", `${event.at.slice(0, 10)}.jsonl`);
    await this.paths.assertNoSymlink(event.topicId, "audit");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.paths.assertNoSymlink(event.topicId, "audit");
    await fs.appendFile(file, `${JSON.stringify({ ...event, message: event.message ? redact(event.message) : undefined })}\n`, "utf8");
  }

  createRun(topicId: TopicId, command: string): AuditRun {
    return new AuditRun(this, topicId, command, this.now);
  }
}

/** Owns event sequence for one CLI command. */
export class AuditRun {
  readonly runId = crypto.randomUUID();
  #seq = 0;

  constructor(private readonly logger: AuditLogger, private readonly topicId: TopicId, private readonly command: string, private readonly now: () => Date) {}

  async start(): Promise<void> { await this.write("run_started"); }
  async finish(message?: string): Promise<void> { await this.write("run_finished", message); }
  async fail(message: string): Promise<void> { await this.write("run_failed", message); }
  async cancel(message = "cancelled"): Promise<void> { await this.write("run_cancelled", message); }
  async tool(tool: string, phase: "started" | "progress" | "finished" | "failed"): Promise<void> {
    this.#seq += 1;
    await this.logger.appendTool(this.topicId, this.runId, this.#seq, tool, phase);
  }
  async model(providerId: string, role: string, durationMs: number, status: string, trace?: { events: number; turns: number; toolCalls: number }): Promise<void> {
    this.#seq += 1;
    await this.logger.appendModel(this.topicId, this.runId, this.#seq, providerId, role, durationMs, status, trace);
  }

  private async write(type: AuditEvent["type"], message?: string): Promise<void> {
    this.#seq += 1;
    await this.logger.append({ runId: this.runId, topicId: this.topicId, seq: this.#seq, type, command: this.command, message, at: this.now().toISOString() });
  }
}

function redact(value: string): string {
  return value
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[REDACTED_CREDENTIAL]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/(?:\/Users\/|\/home\/)[^\s]+/g, "[REDACTED_PATH]");
}
