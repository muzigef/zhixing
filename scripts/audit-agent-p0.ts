/** Local acceptance audit, not a product change or a CI success test.
 * Run: node --import tsx scripts/audit-agent-p0.ts
 * Exit 0: all criteria met; 1: acceptance gaps; 2: audit/environment failure.
 * Uses synthetic workspaces, scripted model responses and real application tools.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { LearningApplication } from "../src/learning-application.js";
import { TaskExecutionStore } from "../src/task-execution.js";
import type { ContinuableModelClient, ModelEvent } from "../src/model.js";

const topic = "agent-development";
const savedInput = { dayId: "D01", kind: "implementation" as const, text: "export const answer = 42;" };
const signal = () => AbortSignal.timeout(30_000);
const call = (tool: string, input: unknown, callId: string): ModelEvent => ({ type: "tool_call", tool, input, callId });
const done: ModelEvent = { type: "done" };
type Check = { id: string; met: boolean; observed: Record<string, unknown> };
const checks: Check[] = [];
const record = (id: string, met: boolean, observed: Record<string, unknown>) => { checks.push({ id, met, observed }); };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-p0-audit-"));
  const app = await LearningApplication.open(root, process.cwd());
  await app.handle("开始第 1 天", topic);
  return { root, app, store: new DesktopStore(path.join(root, "desktop")) };
}
const request = (sessionId: string) => ({ sessionId, text: "完成当前实验任务", topicId: topic, contextAllowed: true, provider: "deepseek-api" as const, style: "adaptive" as const });

async function approvalAudit() {
  const { root, app, store } = await fixture();
  let reopened: LearningApplication | undefined;
  try {
    const firstClient: ContinuableModelClient = {
      async *stream() { yield call("save_artifact", savedInput, "approval-save"); yield done; },
      async *continue() { throw new Error("audit_unexpected_continuation_before_approval"); yield done; },
    };
    const service = new DesktopService(store, () => firstClient, app);
    const session = await service.create();
    await service.send(request(session.id)); await service.idle();
    const before = (await store.load(session.id)).messages.at(-1)!;
    const approval = before.items?.find(item => item.kind === "approval");
    assert(approval && before.status === "waiting");
    app.close();
    reopened = await LearningApplication.open(root);
    let starts = 0; let continuations = 0; let historyTurns = 0; let resultAsUserText = false;
    const secondClient: ContinuableModelClient = {
      async *stream(_prompt, _signal, options) {
        starts++; historyTurns = options?.history?.length ?? 0;
        resultAsUserText = options?.messages?.some(m => m.role === "user" && m.content.includes("应用执行结果")) ?? false;
        yield { type: "text_delta", text: "已收到实际执行结果。" }; yield done;
      },
      async *continue(_prompt, _results, _signal, options) { continuations++; historyTurns = options?.history?.length ?? 0; resultAsUserText = options?.messages?.some(m => m.role === "user" && m.content.includes("应用执行结果")) ?? false; yield { type: "text_delta", text: "已续接工具调用。" }; yield done; },
    };
    const restored = new DesktopService(new DesktopStore(store.root), () => secondClient, reopened);
    await restored.answerInteraction(session.id, approval.id, "allow"); await restored.idle();
    const after = (await restored.load(session.id)).messages.at(-1)!;
    const artifacts = (await reopened.evidence.list(topic, "D01")).artifacts.length;
    record("approval_restart_same_task", after.taskId === before.taskId && artifacts === 1 && after.status === "completed", { sameTaskId: after.taskId === before.taskId, artifacts, status: after.status });
    record("approval_preserves_tool_continuation", continuations > 0 || historyTurns > 0, { starts, continuations, historyTurns, resultAsUserText });
  } finally { if (reopened) reopened.close(); else app.close(); await fs.rm(root, { recursive: true, force: true }); }
}

async function steeringAudit() {
  const { root, app, store } = await fixture();
  let service: DesktopService | undefined;
  try {
    let started = 0; let continued = 0; let ready!: () => void;
    const reachedToolResult = new Promise<void>(resolve => { ready = resolve; });
    const client: ContinuableModelClient = {
      async *stream() {
        if (++started === 1) yield call("save_artifact", savedInput, "steer-save");
        else yield { type: "text_delta", text: "已按补充要求继续。" };
        yield done;
      },
      async *continue(_prompt, _results, abort) {
        if (++continued > 1) { yield { type: "text_delta", text: "已按补充要求继续。" }; yield done; return; }
        yield { type: "text_delta", text: "产物已保存，正在继续。" };
        ready();
        await new Promise<void>(resolve => { if (abort.aborted) resolve(); else abort.addEventListener("abort", () => resolve(), { once: true }); });
        abort.throwIfAborted(); yield done;
      },
    };
    service = new DesktopService(store, () => client, app);
    const session = await service.create();
    await service.send({ ...request(session.id), execution: "session" });
    await reachedToolResult;
    const before = (await service.load(session.id)).messages.at(-1)!;
    await service.enqueue({ ...request(session.id), text: "补充要求：沿用已保存实现，增加一个例子" }, true);
    await service.idle();
    const after = (await store.load(session.id)).messages.at(-1)!;
    const tasks = new TaskExecutionStore(app.database);
    const oldOperations = tasks.snapshot(before.taskId!, topic).operations.length;
    const newOperations = tasks.snapshot(after.taskId!, topic).operations.length;
    record("steering_preserves_task_and_operations", after.taskId === before.taskId && newOperations === oldOperations, { sameTaskId: after.taskId === before.taskId, oldOperations, newOperations, starts: started, status: after.status });
  } finally { service?.stop(); await service?.idle(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
}

async function crashChild(root: string, taskId: string) {
  assert(root && path.basename(root).startsWith("zhixing-p0-audit-") && taskId);
  const app = await LearningApplication.open(root);
  const original = app.submitEvidence.bind(app);
  app.submitEvidence = async (...args) => {
    const artifact = await original(...args);
    process.send?.({ stage: "artifact_saved_before_operation_commit", artifactId: artifact.id });
    await new Promise<void>(() => { setInterval(() => undefined, 1000); });
    return artifact;
  };
  await app.tools(true, { taskId, allowWrites: true }).harness.execute("save_artifact", savedInput, { topicId: topic, maxRisk: "write", signal: signal() });
  throw new Error("audit_crash_point_not_reached");
}

async function crashAudit() {
  const { root, app } = await fixture();
  const taskId = randomUUID(); app.close();
  let reopened: LearningApplication | undefined;
  const child = fork(fileURLToPath(import.meta.url), ["--crash-child", root, taskId], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
  let childError = ""; child.stderr?.on("data", chunk => { childError = (childError + chunk).slice(-2000); });
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, killedBy) => resolve({ code, signal: killedBy })));
  try {
    const artifactId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("audit_crash_child_timeout")), 10_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`audit_child_exited_early: ${childError}`)); });
      child.once("message", message => {
        clearTimeout(timer);
        const value = message as { stage?: string; artifactId?: string };
        if (value.stage !== "artifact_saved_before_operation_commit" || !value.artifactId) reject(new Error("audit_child_protocol"));
        else resolve(value.artifactId);
      });
    });
    child.kill("SIGKILL"); const exit = await exited;
    reopened = await LearningApplication.open(root);
    const tasks = new TaskExecutionStore(reopened.database);
    const before = tasks.snapshot(taskId, topic).operations[0]?.status;
    const result = await reopened.tools(true, { taskId, allowWrites: true }).harness.execute("save_artifact", savedInput, { topicId: topic, maxRisk: "write", signal: signal() });
    const artifacts = (await reopened.evidence.list(topic, "D01")).artifacts;
    const after = tasks.snapshot(taskId, topic).operations[0]?.status;
    record("save_recovers_after_process_kill", exit.signal === "SIGKILL" && before === "running" && result.ok && after === "completed" && artifacts.length === 1 && artifacts[0]?.id === artifactId, { killedBy: exit.signal, before, after, artifacts: artifacts.length, sameArtifactId: artifacts[0]?.id === artifactId });
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } reopened?.close(); await fs.rm(root, { recursive: true, force: true }); }
}

async function repairAudit() {
  if (process.platform !== "darwin") throw new Error("audit_requires_verified_macos_sandbox");
  const { root, app, store } = await fixture();
  try {
    await app.submitEvidence(topic, "D01", "implementation", "export const answer = 41;");
    await app.submitEvidence(topic, "D01", "testScript", "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { answer } from './implementation.mjs'; test('answer', () => assert.equal(answer, 42));");
    let round = 0; let firstExit: unknown;
    const client: ContinuableModelClient = {
      async *stream() { yield call("run_experiment", { dayId: "D01" }, "test-before"); yield done; },
      async *continue(_prompt, results) {
        if (++round === 1) {
          firstExit = (results[0]?.result as { output?: { exitCode: unknown } })?.output?.exitCode;
          yield call("save_artifact", savedInput, "repair-save");
        } else if (round === 2) yield call("run_experiment", { dayId: "D01" }, "test-after");
        else yield { type: "text_delta", text: "已完成修复与重测。" };
        yield done;
      },
    };
    const service = new DesktopService(store, () => client, app); const session = await service.create();
    await service.send({ ...request(session.id), execution: "session" }); await service.idle();
    const message = (await store.load(session.id)).messages.at(-1)!;
    const tasks = new TaskExecutionStore(app.database);
    const operations = tasks.snapshot(message.taskId!, topic).operations;
    const testsRun = operations.filter(item => item.tool === "run_experiment").length;
    const implementationSaved = operations.some(item => item.tool === "save_artifact" && item.status === "completed");
    assert.equal(firstExit, 1, "initial real test must fail due to its assertion");
    record("agent_repairs_and_retests_in_one_run", message.status === "completed" && testsRun === 2, { status: message.status, error: message.error, firstExit, testsRun, implementationSaved });
    const direct = await app.tools(true, { taskId: message.taskId!, allowWrites: true }).harness.execute("run_experiment", { dayId: "D01" }, { topicId: topic, maxRisk: "write", signal: signal() });
    const output = direct.output as { exitCode?: number; status?: string } | undefined;
    record("operation_retry_after_repair", direct.ok && output?.exitCode === 0 && output.status === "completed", { ok: direct.ok, exitCode: output?.exitCode, status: output?.status });
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
}

async function completionAudit() {
  const { root, app, store } = await fixture();
  try {
    for (const actuallySave of [false, true]) {
      let continuation = 0;
      const client: ContinuableModelClient = {
        async *stream() { yield call("plan_task", { steps: [{ id: "save", title: "保存实现", doneWhen: "artifact_saved", kind: "implementation" }] }, "plan"); yield done; },
        async *continue() {
          if (actuallySave && ++continuation === 1) yield call("save_artifact", { ...savedInput, stepId: "save" }, "save");
          else yield { type: "text_delta", text: "全部任务已完成。" };
          yield done;
        },
      };
      const service = new DesktopService(store, () => client, app); const session = await service.create();
      await service.send({ ...request(session.id), execution: "session" }); await service.idle();
      const message = (await store.load(session.id)).messages.at(-1)!;
      const task = new TaskExecutionStore(app.database).snapshot(message.taskId!, topic);
      record(actuallySave ? "task_completion_uses_actual_operation" : "unfinished_plan_prevents_unqualified_completion", actuallySave ? task.completed && message.status === "completed" : message.status !== "completed", { messageStatus: message.status, taskCompleted: task.completed, taskCompletedInUi: message.timings?.taskCompleted, operations: task.operations.length });
    }
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
}

async function main() {
  process.env.ZHIXING_ALLOW_LIVE_PROVIDER = "0";
  if (process.argv[2] === "--crash-child") { await crashChild(process.argv[3]!, process.argv[4]!); return; }
  for (const audit of [approvalAudit, steeringAudit, crashAudit, repairAudit, completionAudit]) {
    const before = checks.length; await audit();
    for (const check of checks.slice(before)) process.stdout.write(`${JSON.stringify(check)}\n`);
  }
  const unmet = checks.filter(check => !check.met).length;
  process.stdout.write(`${JSON.stringify({ total: checks.length, met: checks.length - unmet, unmet, syntheticModels: true, realApplicationTools: true })}\n`);
  process.exitCode = unmet ? 1 : 0;
}
main().catch(error => { process.stderr.write(`audit failed: ${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 2; });
