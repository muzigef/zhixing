import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { LearningApplication } from "../src/learning-application.js";
import type { ContinuableModelClient, ModelEvent } from "../src/model.js";
import { TaskExecutionStore } from "../src/task-execution.js";

const roots: string[] = []; const apps: LearningApplication[] = [];
afterEach(async () => { apps.splice(0).forEach(app => app.close()); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const topic = "agent-development";
const call = (tool: string, input: unknown, callId: string): ModelEvent => ({ type: "tool_call", tool, input, callId });
const done: ModelEvent = { type: "done" };
const plan = { steps: [{ id: "save", title: "保存实现", doneWhen: "artifact_saved", kind: "implementation" }] };
const implementation = { dayId: "D01", kind: "implementation", text: "export const answer = 42;", stepId: "save" };
async function fixture(client: ContinuableModelClient) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-p0-loop-")); roots.push(root);
  const app = await LearningApplication.open(root, process.cwd()); apps.push(app);
  await app.handle("开始第 1 天", topic);
  const store = new DesktopStore(path.join(root, "desktop"));
  const service = new DesktopService(store, () => client, app); const session = await service.create();
  const run = async () => { await service.send({ sessionId: session.id, text: "完成实现并验证", topicId: topic, contextAllowed: true, provider: "deepseek-api", style: "adaptive", execution: "session" }); await service.idle(); return (await store.load(session.id)).messages.at(-1)!; };
  return { app, run };
}

it("retests the same day after a failed test and a real artifact revision within one agent run", async () => {
  let round = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("run_experiment", { dayId: "D01" }, "test-before"); yield done; },
    async *continue() {
      if (++round === 1) yield call("save_artifact", implementation, "fix");
      else if (round === 2) yield call("run_experiment", { dayId: "D01" }, "test-after");
      else yield { type: "text_delta", text: "修复后测试通过。" };
      yield done;
    },
  };
  const { app, run } = await fixture(client);
  await app.submitEvidence(topic, "D01", "implementation", "export const answer = 41;");
  await app.submitEvidence(topic, "D01", "testScript", "synthetic test fixture");
  const validate = vi.spyOn(app, "validateEvidence").mockImplementation(async () => {
    const snapshot = await app.evidence.list(topic, "D01");
    const current = snapshot.artifacts.findLast(item => item.kind === "implementation")!;
    const correct = (await app.evidence.content(topic, "D01", current.id)).includes("42");
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), implementationHash: current.hash, testHash: snapshot.artifacts.findLast(item => item.kind === "testScript")!.hash, status: "completed", exitCode: correct ? 0 : 1, stdout: "synthetic test", stderr: "" };
  });
  const message = await run();
  expect(message.status).toBe("completed"); expect(validate).toHaveBeenCalledTimes(2);
  expect(new TaskExecutionStore(app.database).snapshot(message.taskId!, topic).operations.filter(item => item.tool === "run_experiment").map(item => item.status)).toEqual(["failed", "completed"]);
});

it("continues an unfinished plan after a premature model completion and requires the real artifact", async () => {
  let round = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", plan, "plan"); yield done; },
    async *continue() {
      if (++round === 2) yield call("save_artifact", implementation, "save");
      else yield { type: "text_delta", text: round === 1 ? "未经执行就声称全部完成。" : "实现已保存。" };
      yield done;
    },
  };
  const { app, run } = await fixture(client); const message = await run();
  expect(message.status).toBe("completed"); expect(message.timings?.taskCompleted).toBe(true);
  expect((await app.evidence.list(topic, "D01")).artifacts).toHaveLength(1);
  expect(message.text).toBe("实现已保存。");
  expect(JSON.stringify(message.items)).not.toContain("未经执行就声称全部完成");
});

it("blocks a model that repeatedly declares completion without completing its plan", async () => {
  let continuations = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", plan, "plan"); yield done; },
    async *continue() { continuations++; yield { type: "text_delta", text: "全部任务已完成。" }; yield done; },
  };
  const { app, run } = await fixture(client); const message = await run();
  expect(message.status).toBe("blocked"); expect(message.text).toContain("未完成");
  expect(message.text).not.toContain("全部任务已完成"); expect(continuations).toBeLessThan(6);
  expect(new TaskExecutionStore(app.database).snapshot(message.taskId!, topic).completed).toBe(false);
});

it("resets premature-completion retries when real work advances a multi-step plan", async () => {
  let round = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", { steps: [...plan.steps, { id: "reflect", title: "保存复盘", doneWhen: "artifact_saved", kind: "reflection" }] }, "plan"); yield done; },
    async *continue() {
      round++;
      if (round === 2) yield call("save_artifact", implementation, "save");
      else if (round === 4) yield call("save_artifact", { dayId: "D01", kind: "reflection", text: "合成复盘：已理解实现。", stepId: "reflect" }, "reflect");
      else yield { type: "text_delta", text: "完成。" };
      yield done;
    },
  };
  const { run } = await fixture(client); const message = await run();
  expect(message.status).toBe("completed"); expect(message.timings?.taskCompleted).toBe(true); expect(round).toBe(5);
});

it.each(["remove", "weaken"])("does not let the model %s an unfinished test requirement", async (change) => {
  let round = 0;
  const testStep = { id: "test", title: "测试通过", doneWhen: "tests_passed" };
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", { steps: [...plan.steps, testStep] }, "plan"); yield done; },
    async *continue() {
      if (++round === 1) yield call("save_artifact", implementation, "save");
      else if (round === 2) yield call("plan_task", { steps: change === "remove" ? plan.steps : [...plan.steps, { ...testStep, doneWhen: "artifact_saved" }] }, "rewrite");
      else yield { type: "text_delta", text: "全部任务已完成。" };
      yield done;
    },
  };
  const { app, run } = await fixture(client); const message = await run();
  const snapshot = new TaskExecutionStore(app.database).snapshot(message.taskId!, topic);
  expect(snapshot.plan.find(step => step.id === "test")).toMatchObject({ doneWhen: "tests_passed", completed: false });
  expect(message.status).toBe("blocked"); expect(message.text).not.toContain("全部任务已完成");
});

it.each(["agent", "external"])("requires fresh test evidence after an %s artifact revision", async (source) => {
  let round = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", { steps: [{ id: "test", title: "验证当前实现", doneWhen: "tests_passed" }] }, "plan"); yield done; },
    async *continue() {
      if (++round === 1) yield call("run_experiment", { dayId: "D01", stepId: "test" }, "test");
      else if (round === 2 && source === "agent") yield call("save_artifact", { ...implementation, text: "export const answer = 0;", stepId: undefined }, "break");
      else { if (round === 2) await revise(); yield { type: "text_delta", text: "全部测试已通过。" }; }
      yield done;
    },
  };
  const { app, run } = await fixture(client);
  await app.submitEvidence(topic, "D01", "implementation", implementation.text);
  await app.submitEvidence(topic, "D01", "testScript", "synthetic test fixture");
  const revise = () => app.submitEvidence(topic, "D01", "implementation", "export const answer = 0;");
  vi.spyOn(app, "validateEvidence").mockImplementation(async () => {
    const snapshot = await app.evidence.list(topic, "D01");
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), implementationHash: snapshot.artifacts.findLast(item => item.kind === "implementation")!.hash, testHash: snapshot.artifacts.findLast(item => item.kind === "testScript")!.hash, status: "completed", exitCode: 0, stdout: "synthetic pass", stderr: "" };
  });
  const message = await run();
  expect(message.status).toBe("blocked"); expect(message.timings?.taskCompleted).toBe(false);
  expect(message.text).not.toContain("全部测试已通过");
});

it("recognizes a passing test as progress when the model refreshes task status", async () => {
  let round = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield call("plan_task", { steps: [{ id: "test", title: "验证测试", doneWhen: "tests_passed" }] }, "plan"); yield done; },
    async *continue() {
      round++;
      if (round === 1 || round === 3) yield call("task_status", {}, `status-${round}`);
      else if (round === 2) yield call("run_experiment", { dayId: "D01", stepId: "test" }, "test");
      else yield { type: "text_delta", text: "真实测试已通过。" };
      yield done;
    },
  };
  const { app, run } = await fixture(client);
  await app.submitEvidence(topic, "D01", "implementation", implementation.text);
  await app.submitEvidence(topic, "D01", "testScript", "synthetic test fixture");
  vi.spyOn(app, "validateEvidence").mockImplementation(async () => {
    const snapshot = await app.evidence.list(topic, "D01");
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), implementationHash: snapshot.artifacts.findLast(item => item.kind === "implementation")!.hash, testHash: snapshot.artifacts.findLast(item => item.kind === "testScript")!.hash, status: "completed", exitCode: 0, stdout: "synthetic pass", stderr: "" };
  });
  expect(await run()).toMatchObject({ status: "completed", timings: { taskCompleted: true } });
});

it("checks actual revisions between sequential calls inside one validated tool batch", async () => {
  const client: ContinuableModelClient = {
    async *stream() {
      yield call("run_experiment", { dayId: "D01" }, "before");
      yield call("save_artifact", implementation, "fix");
      yield call("run_experiment", { dayId: "D01" }, "after");
      yield done;
    },
    async *continue(_prompt, results) {
      expect(results[0]?.result).toMatchObject({ output: { exitCode: 1 } });
      expect(results[2]?.result).toMatchObject({ output: { exitCode: 0 } });
      yield { type: "text_delta", text: "修复并重测完成。" }; yield done;
    },
  };
  const { app, run } = await fixture(client);
  await app.submitEvidence(topic, "D01", "implementation", "export const answer = 41;");
  await app.submitEvidence(topic, "D01", "testScript", "synthetic test fixture");
  const validate = vi.spyOn(app, "validateEvidence").mockImplementation(async () => {
    const snapshot = await app.evidence.list(topic, "D01"); const current = snapshot.artifacts.findLast(item => item.kind === "implementation")!;
    const correct = (await app.evidence.content(topic, "D01", current.id)).includes("42");
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), implementationHash: current.hash, testHash: snapshot.artifacts.findLast(item => item.kind === "testScript")!.hash, status: "completed", exitCode: correct ? 0 : 1, stdout: "synthetic result", stderr: "" };
  });
  expect(await run()).toMatchObject({ status: "completed" }); expect(validate).toHaveBeenCalledTimes(2);
});
