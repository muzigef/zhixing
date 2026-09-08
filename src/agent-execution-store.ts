import { permissionSchema, type AgentPermissions } from "./agent-permissions.js";
import { topicIdSchema } from "./contracts.js";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import type { ModelMessage, ModelTurn } from "./model.js";

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string().max(64_000) }),
  z.object({ type: z.literal("tool_call"), tool: z.string().min(1).max(128), input: z.unknown(), callId: z.string().min(1).max(300).optional() }),
]);
const turnSchema = z.object({ events: z.array(eventSchema).max(10_000), toolResults: z.array(z.object({ tool: z.string(), result: z.unknown(), callId: z.string().optional(), toolState: z.string().max(16_000).optional(), dispatch: z.enum(["not_started", "unknown"]).optional() })).max(128), feedback: z.string().max(24_000).optional(), toolState: z.string().max(16_000).optional() });
const decisionSchema = z.object({ answer: z.string().min(1).max(4000), scope: z.enum(["once", "session"]) });
const checkpointSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), status: z.enum(["running", "waiting", "interrupted", "failed", "blocked", "completed"]),
  prompt: z.string().max(128_000), messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "observation"]), content: z.string().max(128_000) })).max(200).optional(),
  history: z.array(turnSchema).max(128),
  pending: turnSchema.extend({ next: z.number().int().min(0).max(128), phase: z.enum(["ready", "executing", "waiting"]), executingUntil: z.number().int().min(1).max(128).optional() }).optional(),
  decisions: z.record(z.string(), decisionSchema).default({}),
  partialText: z.string().max(64_000).optional(),
  containsMaterials: z.boolean().default(false),
  contextAccess: permissionSchema.optional(),
  steerId: z.string().uuid().optional(),
});
export interface ExecutionCheckpoint {
  version: 1 | 2;
  status: z.infer<typeof checkpointSchema>["status"];
  prompt: string;
  messages?: ModelMessage[];
  history: ModelTurn[];
  pending?: ModelTurn & { next: number; phase: "ready" | "executing" | "waiting"; executingUntil?: number };
  decisions: Record<string, z.infer<typeof decisionSchema>>;
  partialText?: string;
  containsMaterials: boolean;
  contextAccess?: AgentPermissions;
  steerId?: string;
}
export interface ExecutionIdentity { taskId: string; sessionId: string; topicId: string; }
export interface TaskUsage { segments: number; modelTurns: number; toolCalls: number; inputTokens: number; outputTokens: number; elapsedMs: number; lastStopReason: string; }
type Row = { session_id: string; topic_id: string; checkpoint: string | null; lease: string | null; pid: number | null };

/** Local execution journal. Canonical transcripts exclude provider-private reasoning.
 * A process lease prevents two frontends from replaying the same live execution.
 * Dead process leases can be reclaimed; waiting/settled invocations release them.
 */
export class AgentExecutionStore {
  private lease?: string;
  constructor(private readonly database: ZhixingDatabase, readonly identity: ExecutionIdentity) {
    z.object({ taskId: z.string().uuid(), sessionId: z.string().uuid(), topicId: topicIdSchema }).parse(identity);
    database.db.exec(`CREATE TABLE IF NOT EXISTS agent_executions (
      task_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, topic_id TEXT NOT NULL, checkpoint TEXT,
      lease TEXT, pid INTEGER);
      CREATE TABLE IF NOT EXISTS agent_execution_events (
      task_id TEXT NOT NULL REFERENCES agent_executions(task_id), sequence INTEGER NOT NULL,
      type TEXT NOT NULL, call_id TEXT, at TEXT NOT NULL, PRIMARY KEY(task_id, sequence));`);
    database.db.exec("CREATE TABLE IF NOT EXISTS agent_task_usage (task_id TEXT PRIMARY KEY REFERENCES agent_executions(task_id), value TEXT NOT NULL)");
  }
  usage(): TaskUsage {
    this.row();
    const row = this.database.db.prepare("SELECT value FROM agent_task_usage WHERE task_id=?").get(this.identity.taskId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as TaskUsage : { segments: 0, modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0, lastStopReason: "not_started" };
  }
  recordUsage(segment: TaskUsage): void {
    if (!this.lease || this.row()?.lease !== this.lease) throw new Error("execution_lease_required");
    const previous = this.usage(); const next = { ...segment };
    for (const key of ["segments", "modelTurns", "toolCalls", "inputTokens", "outputTokens", "elapsedMs"] as const) next[key] = previous[key] + z.number().finite().nonnegative().parse(segment[key]);
    this.database.db.prepare("INSERT INTO agent_task_usage VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET value=excluded.value").run(this.identity.taskId, JSON.stringify(next));
  }
  static claimSession(database: ZhixingDatabase, sessionId: string): () => void {
    z.string().uuid().parse(sessionId);
    database.db.exec("CREATE TABLE IF NOT EXISTS agent_session_leases (session_id TEXT PRIMARY KEY, lease TEXT NOT NULL, pid INTEGER NOT NULL)");
    const token = randomUUID();
    database.db.transaction(() => {
      const owner = database.db.prepare("SELECT pid FROM agent_session_leases WHERE session_id=?").get(sessionId) as { pid: number } | undefined;
      if (owner && isAlive(owner.pid)) throw new Error("session_in_use");
      database.db.prepare("INSERT INTO agent_session_leases VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET lease=excluded.lease, pid=excluded.pid").run(sessionId, token, process.pid);
    })();
    return () => { database.db.prepare("DELETE FROM agent_session_leases WHERE session_id=? AND lease=?").run(sessionId, token); };
  }
  /** One topic checkpoint can be advanced by only one conversation at a time. */
  static claimTeaching(database: ZhixingDatabase, topicId: string): () => void {
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/).parse(topicId);
    database.db.exec("CREATE TABLE IF NOT EXISTS agent_teaching_leases (topic_id TEXT PRIMARY KEY, lease TEXT NOT NULL, pid INTEGER NOT NULL)");
    const token = randomUUID();
    database.db.transaction(() => {
      const owner = database.db.prepare("SELECT pid FROM agent_teaching_leases WHERE topic_id=?").get(topicId) as { pid: number } | undefined;
      if (owner && isAlive(owner.pid)) throw new Error("learning_busy");
      database.db.prepare("INSERT INTO agent_teaching_leases VALUES (?, ?, ?) ON CONFLICT(topic_id) DO UPDATE SET lease=excluded.lease, pid=excluded.pid").run(topicId, token, process.pid);
    })();
    return () => { database.db.prepare("DELETE FROM agent_teaching_leases WHERE topic_id=? AND lease=?").run(topicId, token); };
  }
  private row(): Row | undefined {
    const row = this.database.db.prepare("SELECT * FROM agent_executions WHERE task_id = ?").get(this.identity.taskId) as Row | undefined;
    if (row && (row.session_id !== this.identity.sessionId || row.topic_id !== this.identity.topicId)) throw new Error("execution_scope_mismatch");
    return row;
  }
  read(): ExecutionCheckpoint | undefined {
    const raw = this.row()?.checkpoint;
    if (!raw) return undefined;
    if (Buffer.byteLength(raw) > 1_000_000) throw new Error("execution_storage_limit");
    const value = parseCheckpoint(JSON.parse(raw));
    const restore = (turn: z.infer<typeof turnSchema>): ModelTurn => ({ ...turn, toolResults: turn.toolResults.map(result => ({ ...result, result: result.result ?? null })) });
    return { ...value, history: value.history.map(restore), pending: value.pending ? { ...restore(value.pending), next: value.pending.next, phase: value.pending.phase, executingUntil: value.pending.executingUntil } : undefined };
  }
  claim(): () => void {
    const lease = randomUUID();
    this.database.db.transaction(() => {
      const row = this.row();
      if (row?.lease && row.pid && isAlive(row.pid)) throw new Error("execution_in_use");
      this.database.db.prepare("INSERT INTO agent_executions(task_id, session_id, topic_id, lease, pid) VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET lease=excluded.lease, pid=excluded.pid").run(this.identity.taskId, this.identity.sessionId, this.identity.topicId, lease, process.pid);
    })();
    this.lease = lease;
    return () => {
      this.database.db.prepare("UPDATE agent_executions SET lease=NULL, pid=NULL WHERE task_id=? AND lease=?").run(this.identity.taskId, lease);
      if (this.lease === lease) this.lease = undefined;
    };
  }
  save(value: ExecutionCheckpoint, type: string, callId?: string): void {
    const clean = (turn: ModelTurn) => ({ ...turn, events: turn.events.filter(event => event.type === "text_delta" || event.type === "tool_call") });
    const data = parseCheckpoint({ ...value, history: value.history.map(clean), pending: value.pending ? { ...clean(value.pending), next: value.pending.next, phase: value.pending.phase, executingUntil: value.pending.executingUntil } : undefined });
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized) > 1_000_000) throw new Error("execution_storage_limit");
    z.string().min(1).max(60).parse(type);
    this.database.db.transaction(() => {
      if (!this.lease || this.row()?.lease !== this.lease) throw new Error("execution_lease_required");
      const sequence = (this.database.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM agent_execution_events WHERE task_id=?").get(this.identity.taskId) as { value: number }).value;
      if (sequence > 10_000) throw new Error("execution_event_limit");
      this.database.db.prepare("UPDATE agent_executions SET checkpoint=? WHERE task_id=? AND lease=?").run(serialized, this.identity.taskId, this.lease);
      this.database.db.prepare("INSERT INTO agent_execution_events(task_id, sequence, type, call_id, at) VALUES (?, ?, ?, ?, ?)").run(this.identity.taskId, sequence, type, callId ?? null, new Date().toISOString());
    })();
  }
  decide(callId: string, answer: string, scope: "once" | "session"): void {
    const release = this.claim();
    try {
      const checkpoint = this.read();
      const call = checkpoint?.pending?.events.filter(event => event.type === "tool_call")[checkpoint.pending.next];
      if (!checkpoint || checkpoint.pending?.phase !== "waiting" || call?.callId !== callId ) throw new Error("interaction_resolved");
      const existing = checkpoint.decisions[callId];
      if (existing) { if (existing.answer === answer && existing.scope === scope) return; throw new Error("interaction_resolved"); }
      checkpoint.decisions[callId] = decisionSchema.parse({ answer, scope });
      this.save(checkpoint, "interaction_answered", callId);
    } finally { release(); }
  }
  events(): Array<{ sequence: number; type: string; callId: string | null }> {
    this.row();
    return this.database.db.prepare("SELECT sequence, type, call_id AS callId FROM agent_execution_events WHERE task_id=? ORDER BY sequence").all(this.identity.taskId) as Array<{ sequence: number; type: string; callId: string | null }>;
  }
  static remapSessions(database: ZhixingDatabase, ids: ReadonlyMap<string, string>): void {
    if (database.db.prepare("SELECT name FROM sqlite_master WHERE name='agent_teaching_leases'").get()) database.db.exec("DELETE FROM agent_teaching_leases");
    if (database.db.prepare("SELECT name FROM sqlite_master WHERE name='agent_session_leases'").get()) database.db.exec("DELETE FROM agent_session_leases");
    if (!database.db.prepare("SELECT name FROM sqlite_master WHERE name='agent_executions'").get()) return;
    database.db.transaction(() => {
      for (const [before, after] of ids) {
        const rows = database.db.prepare("SELECT task_id, checkpoint FROM agent_executions WHERE session_id=?").all(before) as { task_id: string; checkpoint: string | null }[];
        for (const row of rows) {
          const checkpoint = row.checkpoint ? parseCheckpoint(JSON.parse(row.checkpoint)) : undefined;
          if (checkpoint) { checkpoint.decisions = {}; if (checkpoint.status !== "completed") checkpoint.status = "interrupted"; }
          database.db.prepare("UPDATE agent_executions SET session_id=?, checkpoint=?, lease=NULL, pid=NULL WHERE task_id=?").run(after, checkpoint ? JSON.stringify(checkpoint) : null, row.task_id);
        }
      }
    })();
  }
}
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function parseCheckpoint(raw: unknown): z.infer<typeof checkpointSchema> {
  if (raw && typeof raw === "object" && "version" in raw && raw.version !== 1 && raw.version !== 2) throw new Error("storage_version_unsupported");
  const parsed = checkpointSchema.safeParse(raw);
  if (!parsed.success) throw new Error("execution_checkpoint_invalid");
  const value = parsed.data; const ids = new Set<string>();
  for (const turn of [...value.history, ...(value.pending ? [value.pending] : [])]) {
    const calls = turn.events.filter(event => event.type === "tool_call");
    for (const call of calls) { if (!call.callId || ids.has(call.callId)) throw new Error("execution_checkpoint_invalid"); ids.add(call.callId); }
    if (turn.toolResults.some((result, index) => result.callId !== calls[index]?.callId || result.tool !== calls[index]?.tool)) throw new Error("execution_checkpoint_invalid");
    if (turn === value.pending) {
      if (!calls.length || value.pending.next !== turn.toolResults.length || value.pending.next > calls.length || value.pending.phase !== "ready" && value.pending.next === calls.length) throw new Error("execution_checkpoint_invalid");
      if (value.pending.executingUntil !== undefined && (value.version !== 2 || value.pending.phase !== "executing" || value.pending.executingUntil <= value.pending.next || value.pending.executingUntil > Math.min(calls.length, value.pending.next + 2))) throw new Error("execution_checkpoint_invalid");
    } else if (calls.length !== turn.toolResults.length) throw new Error("execution_checkpoint_invalid");
  }
  if (Object.keys(value.decisions).some(id => !ids.has(id))) throw new Error("execution_checkpoint_invalid");
  return value;
}
