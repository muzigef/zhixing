import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { TaskExecutionStore } from "../src/task-execution.js";

it.each(["extended plan", "new completion", "cancelled check"])("does not let an old verification overwrite %s", async change => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-task-verify-race-"));
  const app = await LearningApplication.open(root, process.cwd());
  let release!: () => void; const gate = new Promise<boolean>(resolve => { release = () => resolve(false); });
  let ready!: () => void; const checking = new Promise<void>(resolve => { ready = resolve; });
  const controller = new AbortController();
  try {
    const tasks = new TaskExecutionStore(app.database); const id = crypto.randomUUID(); const topic = "rag";
    tasks.begin(id, topic, "合成验证竞态");
    const first = { id: "first", title: "初始步骤", doneWhen: "artifact_saved" as const, kind: "implementation" as const };
    tasks.plan(id, topic, [first]);
    await tasks.execute(id, topic, "save_artifact", { stepId: "first", kind: "implementation", text: "old" }, async () => ({ id: "old" }));
    const pending = tasks.verify(id, topic, async () => { ready(); return gate; }, controller.signal);
    await checking;
    if (change === "extended plan") tasks.plan(id, topic, [{ ...first, title: "保留新标题" }, { id: "second", title: "后续验收", doneWhen: "tests_passed" }]);
    if (change === "new completion") await tasks.execute(id, topic, "save_artifact", { stepId: "first", kind: "implementation", text: "new" }, async () => ({ id: "new" }));
    const current = tasks.snapshot(id, topic).plan;
    if (change === "cancelled check") controller.abort(new Error("cancelled verification"));
    release();
    if (change === "cancelled check") await expect(pending).rejects.toThrow("cancelled verification");
    else await pending;
    const plan = tasks.snapshot(id, topic).plan;
    if (change === "extended plan") {
      expect(plan.map(step => step.title)).toEqual(["保留新标题", "后续验收"]);
      expect(plan[0]?.completed).toBe(false);
    } else expect(plan).toEqual(current);
  } finally { release(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("persists a completed operation across reopen, keeps topic isolation and retries failed steps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-task-execution-"));
  let app = await LearningApplication.open(root, process.cwd());
  try {
    let calls = 0; const id = crypto.randomUUID();
    let tasks = new TaskExecutionStore(app.database); tasks.begin(id, "agent-development", "完成实验");
    await expect(tasks.execute(id, "rag", "save_artifact", {}, async () => null)).rejects.toThrow("cross_topic_denied");
    await expect(tasks.execute(id, "agent-development", "save_artifact", { text: "x" }, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    await tasks.execute(id, "agent-development", "save_artifact", { text: "x" }, async () => { calls++; return { ok: true, id: "artifact" }; });
    app.close(); app = await LearningApplication.open(root, process.cwd()); tasks = new TaskExecutionStore(app.database);
    const result = await tasks.execute(id, "agent-development", "save_artifact", { text: "x" }, async () => { calls++; return null; });
    expect(result).toEqual({ ok: true, id: "artifact" }); expect(calls).toBe(1);
    expect(tasks.snapshot(id, "agent-development").operations).toHaveLength(1);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("requires control-plane permission and reuses artifact IDs including an orphaned write", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-artifact-task-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development");
    const id = crypto.randomUUID(); const task = { taskId: id, allowWrites: false };
    const tools = app.tools(true, task); const signal = new AbortController().signal;
    const input = { dayId: "D01", kind: "implementation", text: "export const answer = 42;" };
    expect((await tools.harness.execute("save_artifact", input, { topicId: "agent-development", signal, maxRisk: "write" })).ok).toBe(false);
    const allowed = app.tools(true, { ...task, allowWrites: true });
    const first = await allowed.harness.execute("save_artifact", input, { topicId: "agent-development", signal, maxRisk: "write" });
    expect(first.ok).toBe(true);
    const second = await allowed.harness.execute("save_artifact", input, { topicId: "agent-development", signal, maxRisk: "write" });
    expect(second.output).toEqual(first.output);
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
    const renamed = await allowed.harness.execute("save_artifact", { ...input, stepId: "renamed" }, { topicId: "agent-development", signal, maxRisk: "write" });
    expect(renamed.output).toEqual(first.output);
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
    const saved = first.output as { id: string };
    await fs.appendFile(app.paths.resolveTopicPath("agent-development", "notes", "evidence", "D01", `${saved.id}.txt`), "changed");
    expect((await allowed.harness.execute("save_artifact", input, { topicId: "agent-development", signal, maxRisk: "write" })).ok).toBe(false);
    const artifactId = crypto.randomUUID(); const content = "orphaned but valid";
    await fs.writeFile(app.paths.resolveTopicPath("agent-development", "notes", "evidence", "D01", `${artifactId}.txt`), content);
    const repaired = await app.evidence.submit("agent-development", "D01", "reflection", content, artifactId);
    expect(repaired.intact).toBe(true);
    await expect(app.evidence.submit("agent-development", "D01", "reflection", "different contents", artifactId)).rejects.toThrow("idempotency_conflict");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
