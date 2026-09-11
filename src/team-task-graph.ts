import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { plannedTaskSchema, teamTaskRetryProblem, type TeamTask } from "./team-work-contracts.js";
export type { TeamTask } from "./team-work-contracts.js";

export function retryableTask(tasks: readonly TeamTask[] | undefined, id: string): TeamTask {
  const problem = teamTaskRetryProblem(tasks, id); if (problem) throw new Error(problem);
  return tasks!.find(item => item.id === id)!;
}
export function parseTaskPlan(value: unknown, members: number) {
  const { tasks } = z.object({ tasks: z.array(plannedTaskSchema).min(1).max(4) }).strict().parse(value);
  const keys = new Set(tasks.map(task => task.id));
  if (keys.size !== tasks.length || tasks.some(task => task.member > members || new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.some(id => !keys.has(id)))) throw new Error("team_plan_invalid");
  if (Array.from({ length: members }, (_, index) => index + 1).some(member => !tasks.some(task => task.member === member))) throw new Error("team_plan_invalid");
  const visited = new Set<string>(); const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error("team_plan_cycle");
    if (visited.has(id)) return;
    active.add(id); for (const dependency of tasks.find(task => task.id === id)!.dependsOn) visit(dependency);
    active.delete(id); visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  return tasks;
}
export function createTaskGraph(tasks: ReturnType<typeof parseTaskPlan>): TeamTask[] {
  return tasks.map(({ id, ...task }) => ({ ...task, key: id, id: randomUUID(), status: "queued", attempts: 0 }));
}
/** Internal wire contracts are not user deliverables. Reject obvious stage leakage before
 * dispatch, but allow a user who is actually asking to design those protocols. This is a
 * narrow guard, not a claim that arbitrary plan semantics have been automatically verified. */
export function validatePlanScope(tasks: ReturnType<typeof parseTaskPlan>, question: string): void {
  const normalized = question.replace(/\s/g, "").toLowerCase();
  const internal = /TEAM_(?:PLAN|MEMBER|REVIEW|FOLLOWUP)|任务(?:安排|分工|计划|规划)\s*(?:的\s*)?JSON|(?:成员|审查|复核)报告\s*(?:的\s*)?(?:JSON|格式|契约)|主\s*(?:Agent|模型)\s*(?:的\s*)?最终(?:回答|输出|JSON|正文)/gi;
  for (const task of tasks) for (const value of [task.goal, ...task.acceptance]) {
    for (const match of value.matchAll(internal)) if (!normalized.includes(match[0].replace(/\s/g, "").toLowerCase())) throw new Error("team_plan_invalid");
  }
}
/** Each wave persists dispatch intent first; dependencies and worker ownership are runtime checks. */
export async function runTaskGraph(tasks: TeamTask[], concurrency: number, execute: (task: TeamTask) => Promise<void>, save: () => Promise<void>, signal: AbortSignal): Promise<void> {
  while (tasks.some(task => task.status === "queued")) {
    signal.throwIfAborted();
    const byKey = new Map(tasks.map(task => [task.key, task]));
    let changed = false;
    for (const task of tasks.filter(item => item.status === "queued")) {
      if (task.dependsOn.some(id => !byKey.has(id) || ["failed", "cancelled", "interrupted", "blocked"].includes(byKey.get(id)!.status))) { task.status = "blocked"; task.failureCode = "incomplete"; changed = true; }
    }
    const occupied = new Set<number>(); const ready = tasks.filter(task => {
      if (task.status !== "queued" || occupied.has(task.member) || !task.dependsOn.every(id => byKey.get(id)?.status === "completed")) return false;
      occupied.add(task.member); return true;
    }).slice(0, Math.max(1, concurrency));
    if (!ready.length) {
      if (changed) { await save(); continue; }
      if (tasks.some(task => task.status === "queued")) throw new Error("team_plan_deadlock");
      return;
    }
    for (const task of ready) {
      if (task.attempts >= 3) throw new Error("team_task_not_retryable");
      task.status = "running"; task.attempts++; task.executionId = randomUUID();
      for (const run of task.runs ?? []) if (run.status === "running") run.status = "interrupted";
      (task.runs ??= []).push({ executionId: task.executionId, status: "running" });
    }
    await save(); signal.throwIfAborted();
    const results = await Promise.allSettled(ready.map(execute));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (ready.some(task => task.status === "running")) throw new Error("team_task_unsettled");
    for (const task of ready) { const run = task.runs!.at(-1)!; run.status = task.status === "queued" ? "interrupted" : task.status; run.failureCode = task.failureCode; }
    await save();
  }
}
