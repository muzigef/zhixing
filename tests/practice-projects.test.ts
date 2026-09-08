import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { DesktopStore } from "../desktop/core/store.js";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../desktop/core/workspace-backup.js";
import { TaskExecutionStore } from "../src/task-execution.js";
import { verifiedTaskSnapshot } from "../src/application-tools.js";
import { McpSettings } from "../src/mcp-settings.js";
import type { ContinuableModelClient, ToolResultMessage } from "../src/model.js";
import { Ajv } from "ajv";
import { onDemandTools } from "../src/agent-efficiency.js";
import { attachProjectTools } from "../src/project-tools.js";

const clean: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of clean.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-project-")); const app = await LearningApplication.open(path.join(root, "workspace"));
  clean.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, app };
}
const signal = () => new AbortController().signal;
it("discovers the complete project plan contract and rejects course-only fields in its advertised schema", async () => {
  const { app } = await fixture(); const project = await app.projects.create("rag", "计划契约", signal()); app.projects.select("rag", project.id);
  const taskId = crypto.randomUUID(); const catalog = onDemandTools(attachProjectTools(app, app.tools(true, { taskId, allowWrites: true }), "rag", taskId));
  const result = await catalog.harness.execute("discover_tools", { category: "project" }, { topicId: "rag", signal: signal() });
  expect(JSON.stringify(result.output)).toContain("plan_task");
  const definition = catalog.advertised().find(tool => tool.name === "plan_task")!; expect(definition).toBeDefined();
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(definition.inputSchema);
  const steps = [{ id: "edit", title: "修改", doneWhen: "project_file_saved", projectId: project.id }];
  expect(validate({ steps })).toBe(true);
  expect(validate({ steps: [{ ...steps[0], kind: "implementation" }] })).toBe(false);
  expect(validate({ steps: [{ id: "edit", title: "修改", doneWhen: "project_file_saved" }] })).toBe(false);
  expect((await catalog.harness.execute("plan_task", { steps }, { topicId: "rag", signal: signal() })).ok).toBe(true);
  expect(catalog.advertised().some(tool => tool.name === "save_artifact")).toBe(false);
}, 15_000);
it("creates an isolated multi-file Git project, previews exact changes and prevents stale writes", async () => {
  const { app } = await fixture(); const project = await app.projects.create("rag", "合成实践", signal());
  expect(project.files.map(file => file.path)).toEqual(expect.arrayContaining(["src/implementation.mjs", "test/implementation.test.mjs"]));
  const before = await app.projects.read("rag", project.id, "src/implementation.mjs");
  const input = { path: before.path, expectedHash: before.hash, content: "export const solve = value => value * 2;\n" };
  expect(await app.projects.preview("rag", project.id, input)).toContain("+export const solve");
  const changed = await app.projects.write("rag", project.id, input, signal()); expect(changed.treeHash).not.toBe(project.treeHash);
  expect(await app.projects.write("rag", project.id, input, signal())).toMatchObject({ hash: changed.hash });
  await expect(app.projects.write("rag", project.id, { ...input, content: "different" }, signal())).rejects.toThrow("project_file_conflict");
  await expect(app.projects.snapshot("tool-calling", project.id)).rejects.toThrow("cross_topic_denied");
  expect((await app.projects.snapshot("rag", project.id)).diff).toContain("value * 2");
  expect((await app.projects.snapshot("rag", project.id)).branch).toBe(`practice/${project.id}`);
});

it("runs actual nested Node tests and only checkpoints the exact passing tree", async () => {
  const { app } = await fixture(); const project = await app.projects.create("rag", "实际测试", signal());
  await expect(app.projects.checkpoint("rag", project.id, project.treeHash, "before test", signal())).rejects.toThrow("project_tests_required");
  const result = await app.projects.test("rag", project.id, project.treeHash, signal());
  expect(result).toMatchObject({ status: "completed", exitCode: 0, treeHash: project.treeHash }); expect(result.stdout).toContain("pass");
  const commit = await app.projects.checkpoint("rag", project.id, project.treeHash, "已验证", signal()); expect(commit.commit).toMatch(/^[a-f0-9]{40}$/);
  const source = await app.projects.read("rag", project.id, "src/implementation.mjs");
  await app.projects.write("rag", project.id, { path: source.path, expectedHash: source.hash, content: "export const solve = () => -1;\n" }, signal());
  const changed = await app.projects.snapshot("rag", project.id); expect(changed.currentTestsPassed).toBe(false);
  await expect(app.projects.test("rag", project.id, project.treeHash, signal())).rejects.toThrow("project_tree_conflict");
  const failed = await app.projects.test("rag", project.id, changed.treeHash, signal()); expect(failed.exitCode).not.toBe(0);
  await expect(app.projects.checkpoint("rag", project.id, changed.treeHash, "cannot pass", signal())).rejects.toThrow("project_tests_required");
});

it("rejects traversal, private files, symlinks and linked repository metadata", async () => {
  const { root, app } = await fixture(); const project = await app.projects.create("rag", "边界", signal());
  for (const file of ["../outside.mjs", "/tmp/outside.mjs", ".env", "auth.json", ".git/config", "src/key.pem", "src/../outside.mjs"]) {
    await expect(app.projects.read("rag", project.id, file)).rejects.toThrow();
    await expect(app.projects.write("rag", project.id, { path: file, expectedHash: null, content: "synthetic" }, signal())).rejects.toThrow();
  }
  const directory = path.join(app.root, "zhixing/projects/rag", project.id);
  const outside = path.join(root, "outside.mjs"); await fs.writeFile(outside, "untouched");
  await fs.symlink(outside, path.join(directory, "files/link.mjs"));
  await expect(app.projects.read("rag", project.id, "link.mjs")).rejects.toThrow();
  await fs.unlink(path.join(directory, "files/link.mjs"));
  await fs.rename(path.join(directory, "repository.git"), path.join(directory, "old-repository"));
  await fs.symlink(root, path.join(directory, "repository.git"));
  await expect(app.projects.snapshot("rag", project.id)).rejects.toThrow(); expect(await fs.readFile(outside, "utf8")).toBe("untouched");
});

it("imports explicit text files without changing the original or copying its Git metadata", async () => {
  const { root, app } = await fixture(); const source = path.join(root, "selected"); await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.mkdir(path.join(source, ".git")); await fs.writeFile(path.join(source, ".git", "placeholder"), "original metadata");
  await fs.writeFile(path.join(source, "src/example.mjs"), "export const answer = 42;");
  const project = await app.projects.create("rag", "导入", signal(), source);
  expect(project.files.map(file => file.path)).toEqual(["src/example.mjs"]);
  await app.projects.write("rag", project.id, { path: "src/example.mjs", expectedHash: project.files[0]!.hash, content: "export const answer = 43;" }, signal());
  expect(await fs.readFile(path.join(source, "src/example.mjs"), "utf8")).toBe("export const answer = 42;");
  await expect(app.projects.test("rag", project.id, (await app.projects.snapshot("rag", project.id)).treeHash, signal())).rejects.toThrow("project_tests_required");
});

it("restores files and portable Git history while clearing project selection and MCP grants", async () => {
  const { root, app } = await fixture(); const project = await app.projects.create("rag", "备份", signal()); app.projects.select("rag", project.id);
  await app.projects.write("rag", project.id, { path: "notes.md", expectedHash: null, content: "合成练习记录。" }, signal());
  const tree = await app.projects.snapshot("rag", project.id); await app.projects.test("rag", project.id, tree.treeHash, signal());
  const checkpoint = await app.projects.checkpoint("rag", project.id, tree.treeHash, "第二个检查点", signal());
  const settings = new McpSettings(app.database); settings.replace("rag", 0, [{ id: "unused-fixture", enabled: true, consent: "local-process-and-topic-inputs", command: process.execPath, args: [], tools: [] }]);
  const desktop = new DesktopStore(path.join(root, "desktop")); const backup = await createWorkspaceBackup(app, desktop, path.join(root, "exports"), "0.5.0", signal());
  const restored = await restoreWorkspaceBackup(backup, path.join(root, "restored"), desktop, signal()); const copy = await LearningApplication.open(restored.workspace);
  try { const result = await copy.projects.snapshot("rag", project.id); expect(result.treeHash).toBe(tree.treeHash); expect(result.head).toBe(checkpoint.commit); expect(result.history).toHaveLength(2); expect(copy.projects.selected("rag")).toBeNull(); expect(new McpSettings(copy.database).read("rag").servers[0]?.enabled).toBe(false); }
  finally { copy.close(); }
});

it("integrates project discovery, exact diff approval, execution and source-bound plan verification", async () => {
  const { root, app } = await fixture(); const project = await app.projects.create("rag", "Agent 实践", signal()); app.projects.select("rag", project.id);
  const source = await app.projects.read("rag", project.id, "src/implementation.mjs"); let completedCalls = 0;
  const client = { async *stream() { yield { type: "tool_call" as const, tool: "plan_task", callId: "plan", input: { steps: [{ id: "edit", title: "保存项目实现", doneWhen: "project_file_saved", projectId: project.id }] } }; yield { type: "tool_call" as const, tool: "project_edit", callId: "edit", input: { projectId: project.id, path: source.path, expectedHash: source.hash, content: "export const solve = value => value + 0;\n", stepId: "edit" } }; yield { type: "done" as const }; },
    async *continue() { completedCalls++; yield { type: "text_delta" as const, text: "修改已保存。" }; yield { type: "done" as const }; } };
  const store = new AgentSessionStore(path.join(root, "sessions")); const service = new AgentService(store, () => client, app); const session = await service.create();
  await service.send({ sessionId: session.id, text: "修改当前项目", topicId: "rag", contextAllowed: true, provider: "mock", style: "adaptive" }); await service.idle();
  const waiting = (await service.load(session.id)).messages.at(-1)!; expect(waiting.status).toBe("waiting");
  const card = waiting.items!.find(item => item.kind === "approval")!; expect(card).toMatchObject({ preview: expect.stringContaining("+export const solve") });
  await service.answerInteraction(session.id, card.id, "allow", "once"); await service.idle();
  expect(completedCalls).toBe(1); const tasks = new TaskExecutionStore(app.database);
  expect((await verifiedTaskSnapshot(app, tasks, waiting.taskId!, "rag")).completed).toBe(true);
  const changed = await app.projects.read("rag", project.id, source.path);
  await app.projects.write("rag", project.id, { path: source.path, expectedHash: changed.hash, content: "export const solve = () => 0;" }, signal());
  expect((await verifiedTaskSnapshot(app, tasks, waiting.taskId!, "rag")).completed).toBe(false);
});

it("completes a source-bound project plan through discovery, editing, real tests and Git, then invalidates it on change", async () => {
  const { root, app } = await fixture(); const project = await app.projects.create("rag", "完整执行", signal()); app.projects.select("rag", project.id);
  const source = await app.projects.read("rag", project.id, "src/implementation.mjs"); let turn = 0;
  const client: ContinuableModelClient = {
    async *stream() { yield { type: "tool_call", tool: "discover_tools", input: { category: "project" }, callId: "discover" }; yield { type: "done" }; },
    async *continue(_prompt, results: readonly ToolResultMessage[]) {
      turn++;
      if (turn === 1) {
        expect(JSON.stringify(results)).toContain("project_checkpoint");
        yield { type: "tool_call", tool: "plan_task", input: { steps: [{ id: "edit", title: "实现", doneWhen: "project_file_saved", projectId: project.id }, { id: "test", title: "测试", doneWhen: "project_tests_passed", projectId: project.id }, { id: "git", title: "检查点", doneWhen: "project_checkpoint_saved", projectId: project.id }] }, callId: "plan" };
        yield { type: "tool_call", tool: "project_edit", input: { projectId: project.id, path: source.path, expectedHash: source.hash, content: "export const solve = value => value + 0;\n", stepId: "edit" }, callId: "edit" };
      } else if (turn === 2) {
        const output = (results.at(-1)!.result as { output: { treeHash: string } }).output;
        yield { type: "tool_call", tool: "project_test", input: { projectId: project.id, expectedTreeHash: output.treeHash, stepId: "test" }, callId: "test" };
      } else if (turn === 3) {
        const output = (results[0]!.result as { output: { treeHash: string; exitCode: number } }).output; expect(output.exitCode).toBe(0);
        yield { type: "tool_call", tool: "project_checkpoint", input: { projectId: project.id, expectedTreeHash: output.treeHash, title: "合成验证", stepId: "git" }, callId: "git" };
      } else yield { type: "text_delta", text: "实际测试通过，Git 检查点已保存。" };
      yield { type: "done" };
    },
  };
  const store = new AgentSessionStore(path.join(root, "sessions")); const service = new AgentService(store, () => client, app); const session = await service.create();
  await service.send({ sessionId: session.id, text: "完成项目修改与测试", topicId: "rag", contextAllowed: true, execution: "session", provider: "mock", style: "adaptive" }); await service.idle();
  for (let index = 0; index < 3; index++) {
    const waiting = (await service.load(session.id)).messages.at(-1)!;
    expect(waiting.status).toBe("waiting");
    const card = waiting.items!.find(item => item.kind === "approval" && item.status === "pending")!;
    await service.answerInteraction(session.id, card.id, "allow"); await service.idle();
  }
  const answer = (await service.load(session.id)).messages.at(-1)!; expect(answer.status).toBe("completed");
  const tasks = new TaskExecutionStore(app.database); expect((await verifiedTaskSnapshot(app, tasks, answer.taskId!, "rag")).plan.map(step => step.completed)).toEqual([true, true, true]);
  const snapshot = await app.projects.snapshot("rag", project.id); expect(snapshot.currentTestsPassed).toBe(true); expect(snapshot.history).toHaveLength(2);
  const file = await app.projects.read("rag", project.id, source.path); await app.projects.write("rag", project.id, { path: file.path, expectedHash: file.hash, content: "export const solve = value => value + 1;" }, signal());
  expect((await verifiedTaskSnapshot(app, tasks, answer.taskId!, "rag")).plan.map(step => step.completed)).toEqual([false, false, false]);
});

it("refuses Git alternates before invoking Git and does not reuse project access after deselection", async () => {
  const { root, app } = await fixture(); const project = await app.projects.create("rag", "边界复核", signal()); app.projects.select("rag", project.id);
  const { attachProjectTools } = await import("../src/project-tools.js"); const taskId = crypto.randomUUID(); new TaskExecutionStore(app.database).begin(taskId, "rag", "fixture");
  const tools = attachProjectTools(app, app.tools(true), "rag", taskId); app.projects.select("rag", null);
  expect((await tools.harness.execute("project_read", { projectId: project.id, path: "src/implementation.mjs" }, { topicId: "rag", signal: signal() })).ok).toBe(false);
  await fs.writeFile(path.join(app.root, "zhixing/projects/rag", project.id, "repository.git/objects/info/alternates"), root);
  await expect(app.projects.snapshot("rag", project.id)).rejects.toThrow("project_git_invalid");
});

it("pages large escaped files through the real tool output bound without losing content or hashes", async () => {
  const { app } = await fixture(); const project = await app.projects.create("rag", "分段读取", signal()); app.projects.select("rag", project.id);
  const content = '"'.repeat(20_000); await app.projects.write("rag", project.id, { path: "large.txt", expectedHash: null, content }, signal());
  const { attachProjectTools } = await import("../src/project-tools.js"); const tools = attachProjectTools(app, app.tools(true), "rag", crypto.randomUUID());
  let offset = 0; let complete = ""; const hashes = new Set<string>();
  do {
    const result = await tools.harness.execute("project_read", { projectId: project.id, path: "large.txt", offset }, { topicId: "rag", signal: signal() }); expect(result.ok).toBe(true);
    const page = result.output as { content: string; hash: string; nextOffset: number | null };
    expect(JSON.stringify(result.output).length).toBeLessThan(12_000); complete += page.content; hashes.add(page.hash); offset = page.nextOffset ?? -1;
  } while (offset !== -1);
  expect(complete).toBe(content); expect(hashes.size).toBe(1);
  const stale = await tools.harness.execute("project_edit", { projectId: project.id, path: "large.txt", expectedHash: "0".repeat(64), content: "new" }, { topicId: "rag", maxRisk: "write", signal: signal() });
  expect(stale).toMatchObject({ ok: false, errorCode: "project_file_conflict" });
});
