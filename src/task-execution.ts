import crypto from "node:crypto";
import { z } from "zod";
import type { ZhixingDatabase } from "./database.js";

export const taskPlanSchema = z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), title: z.string().min(1).max(120), doneWhen: z.enum(["artifact_saved", "tests_passed"]), kind: z.enum(["implementation", "testScript", "testOutput", "failureCase", "reflection"]).optional() }).strict()).min(1).max(12);
export type TaskPlanStep = z.infer<typeof taskPlanSchema>[number] & { completed: boolean };
export const operationKey = (tool: string, input: unknown) => crypto.createHash("sha256").update(`${tool}:${JSON.stringify(input, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)}`).digest("hex");
export function operationArtifactId(key: string): string { return `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`; }
const active = new WeakMap<ZhixingDatabase, Map<string, Promise<unknown>>>();

/** Only replay-safe application operations use this store; arbitrary commands cannot be resumed. */
export class TaskExecutionStore {
  constructor(private readonly database: ZhixingDatabase) {
    database.db.exec(`CREATE TABLE IF NOT EXISTS assistant_tasks (id TEXT PRIMARY KEY, topic TEXT NOT NULL, goal TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS assistant_operations (task_id TEXT NOT NULL REFERENCES assistant_tasks(id), key TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, result TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(task_id, key));`);
  }
  begin(id: string, topic: string, goal: string) {
    z.string().uuid().parse(id);
    this.database.db.prepare("INSERT OR IGNORE INTO assistant_tasks(id, topic, goal) VALUES (?, ?, ?)").run(id, topic, goal.slice(0, 4000));
    this.snapshot(id, topic);
  }
  snapshot(id: string, topic: string) {
    const row = this.database.db.prepare("SELECT topic, goal, plan FROM assistant_tasks WHERE id = ?").get(id) as { topic: string; goal: string; plan: string } | undefined;
    if (!row) throw new Error("task_not_found");
    if (row.topic !== topic) throw new Error("cross_topic_denied");
    const plan = JSON.parse(row.plan) as TaskPlanStep[];
    const operations = this.database.db.prepare("SELECT key, tool, status, result, input FROM assistant_operations WHERE task_id = ? ORDER BY updated_at").all(id) as { key: string; tool: string; status: string; result: string | null; input: string }[];
    return { id, goal: row.goal, plan, completed: plan.length > 0 && plan.every((step) => step.completed), operations: operations.map((item) => ({ ...item, input: JSON.parse(item.input) as unknown, result: item.result ? JSON.parse(item.result) as unknown : null })) };
  }
  plan(id: string, topic: string, raw: unknown) {
    const previous = this.snapshot(id, topic).plan;
    const steps = taskPlanSchema.parse(raw);
    if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new Error("task_plan_invalid");
    const plan = steps.map((step) => ({ ...step, completed: previous.some((old) => old.id === step.id && old.doneWhen === step.doneWhen && old.kind === step.kind && old.completed) }));
    this.database.db.prepare("UPDATE assistant_tasks SET plan = ? WHERE id = ?").run(JSON.stringify(plan), id);
    return plan;
  }
  async execute(id: string, topic: string, tool: string, input: unknown, action: (key: string) => Promise<unknown>, validateCached?: (result: unknown) => Promise<void>): Promise<unknown> {
    const snapshot = this.snapshot(id, topic);
    const stableInput = input && typeof input === "object" ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "stepId")) : input;
    const key = operationKey(tool, stableInput);
    const existing = snapshot.operations.find((item) => item.key === key);
    if (existing?.status === "completed") { await validateCached?.(existing.result); this.completeStep(id, topic, tool, input, existing.result); return existing.result; }
    if (!existing && snapshot.operations.length >= 64 || JSON.stringify(input).length > 32_000) throw new Error("task_operation_limit");
    const locks = active.get(this.database) ?? new Map<string, Promise<unknown>>(); active.set(this.database, locks);
    const lockKey = `${id}:${key}`; const running = locks.get(lockKey); if (running) return running;
    const operation = (async () => {
      this.database.db.prepare("INSERT INTO assistant_operations(task_id, key, tool, input, status, updated_at) VALUES (?, ?, ?, ?, 'running', ?) ON CONFLICT(task_id, key) DO UPDATE SET status='running', updated_at=excluded.updated_at").run(id, key, tool, JSON.stringify(input), new Date().toISOString());
      try {
        const result = await action(operationKey(id, key));
        const serialized = JSON.stringify(result ?? null); if (serialized.length > 64_000) throw new Error("task_result_limit");
        const successful = !(result && typeof result === "object" && "ok" in result && result.ok === false);
        this.database.db.prepare("UPDATE assistant_operations SET status = ?, result = ?, updated_at = ? WHERE task_id = ? AND key = ?").run(successful ? "completed" : "failed", serialized, new Date().toISOString(), id, key);
        if (successful) this.completeStep(id, topic, tool, input, result);
        return result;
      } catch (error) { this.database.db.prepare("UPDATE assistant_operations SET status='failed', updated_at=? WHERE task_id=? AND key=?").run(new Date().toISOString(), id, key); throw error; }
    })();
    locks.set(lockKey, operation);
    try { return await operation; } finally { locks.delete(lockKey); }
  }
  private completeStep(id: string, topic: string, tool: string, input: unknown, result: unknown) {
    const data = input as { stepId?: string; kind?: string };
    const plan = this.snapshot(id, topic).plan;
    const step = plan.find((item) => item.id === data.stepId);
    if (!step) return;
    const validation = result as { status?: string; exitCode?: number };
    if (step.doneWhen === "artifact_saved" && tool === "save_artifact" && (!step.kind || step.kind === data.kind)
      || step.doneWhen === "tests_passed" && tool === "run_experiment" && validation.status === "completed" && validation.exitCode === 0) step.completed = true;
    this.database.db.prepare("UPDATE assistant_tasks SET plan = ? WHERE id = ?").run(JSON.stringify(plan), id);
  }
}
