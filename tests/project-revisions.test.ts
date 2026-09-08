import { runPythonTests } from "../src/python-runner.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { attachProjectTools } from "../src/project-tools.js";
import { TaskExecutionStore } from "../src/task-execution.js";
import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { unifiedDiff, applyReplacements } from "../src/project-diff.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
const signal = () => new AbortController().signal;
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-revisions-")); const app = await LearningApplication.open(root, process.cwd());
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await app.projects.create("rag", "合成快照项目", signal()); return { root, app, project };
}
it("shows context hunks and applies only unique, nonoverlapping source replacements", () => {
  const before = Array.from({ length: 100 }, (_, i) => `line ${i}\n`).join(""); const after = before.replace("line 50\n", "changed\n");
  const diff = unifiedDiff("notes.txt", before, after);
  expect(diff).toContain("-line 50\n+changed"); expect(diff).not.toContain("line 0\n"); expect(diff.split("\n").length).toBeLessThan(15);
  expect(applyReplacements(before, [{ before: "line 50\n", after: "changed\n" }])).toBe(after);
  expect(() => applyReplacements("same same", [{ before: "same", after: "new" }])).toThrow("project_patch_ambiguous");
  expect(() => applyReplacements("abcdef", [{ before: "abc", after: "x" }, { before: "bcde", after: "y" }])).toThrow("project_patch_overlap");
});
it("captures before-edit bytes, atomically validates batches, previews restore, and preserves Git history", async () => {
  const { app, project } = await fixture(); const file = await app.projects.read("rag", project.id, "src/implementation.mjs");
  const edits = [{ path: file.path, expectedHash: file.hash, content: "export const solve = value => value + 0;\n" }, { path: "notes.md", expectedHash: null, content: "合成修改记录" }];
  await expect(app.projects.writeMany("rag", project.id, [...edits, { path: "bad.md", expectedHash: "a".repeat(64), content: "invalid" }], signal())).rejects.toThrow("project_file_conflict");
  expect((await app.projects.snapshot("rag", project.id)).treeHash).toBe(project.treeHash);
  await expect(app.projects.writeMany("rag", project.id, [{ path: "Case.md", expectedHash: null, content: "one" }, { path: "case.md", expectedHash: null, content: "two" }], signal())).rejects.toThrow("project_path_collision");
  const changed = await app.projects.writeMany("rag", project.id, edits, signal()); expect(changed.snapshotId).toBeTruthy();
  const preview = await app.projects.previewRestore("rag", project.id, changed.snapshotId!, changed.treeHash);
  expect(preview).toContain("-合成修改记录"); expect(preview).toContain(`+${file.content.trim()}`);
  await app.projects.test("rag", project.id, changed.treeHash, signal());
  await expect(app.projects.restore("rag", project.id, changed.snapshotId!, project.treeHash, signal())).rejects.toThrow("project_tree_conflict");
  await app.projects.restore("rag", project.id, changed.snapshotId!, changed.treeHash, signal());
  const restored = await app.projects.snapshot("rag", project.id);
  expect(restored.treeHash).toBe(project.treeHash); expect(restored.head).toBe(project.head); expect(restored.currentTestsPassed).toBe(false);
  expect(restored.snapshots).toHaveLength(2);
});
it("rolls back an installation failure without leaving a partially edited project", async () => {
  const { app, project } = await fixture(); const rename = fs.rename.bind(fs); let failed = false;
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (!failed && String(from).endsWith("/next") && String(to).endsWith("/files")) { failed = true; throw new Error("synthetic_install_failure"); }
    return rename(from, to);
  });
  await expect(app.projects.writeMany("rag", project.id, [{ path: "new.md", expectedHash: null, content: "合成新文件" }], signal())).rejects.toThrow("synthetic_install_failure");
  expect(failed).toBe(true); expect((await app.projects.snapshot("rag", project.id)).treeHash).toBe(project.treeHash);
});
it("runs bounded Python unittest files with actual pass/failure and denies outside-file access", async () => {
  const { root, app, project } = await fixture(); const outside = path.join(root, "outside-fixture.txt"); await fs.writeFile(outside, "synthetic private data");
  const content = `import unittest, socket\nclass Boundaries(unittest.TestCase):\n def test_answer(self):\n  self.assertEqual(2 + 2, 4)\n def test_outside(self):\n  with self.assertRaises(PermissionError):\n   open(${JSON.stringify(outside)}).read()\n def test_network(self):\n  with self.assertRaises(PermissionError):\n   with socket.socket() as client:\n    client.connect(("127.0.0.1", 9))\n`;
  const changed = await app.projects.writeMany("rag", project.id, [{ path: "test/test_example.py", expectedHash: null, content }], signal());
  const result = await app.projects.test("rag", project.id, changed.treeHash, signal());
  if (process.platform === "darwin") { expect(result, result.stderr).toMatchObject({ status: "completed", exitCode: 0 }); expect(result.stderr).toContain("Ran 3 tests"); }
  else expect(result.status).toBe("unavailable");
  const file = await app.projects.read("rag", project.id, "test/test_example.py");
  const failed = await app.projects.write("rag", project.id, { path: file.path, expectedHash: file.hash, content: content.replace("2 + 2, 4", "2 + 2, 5") }, signal());
  const failure = await app.projects.test("rag", project.id, failed.treeHash, signal());
  if (process.platform === "darwin") { expect(failure.exitCode).toBe(1); expect(failure.stderr).toContain("FAILED"); }
});

it("recovers a real process crash between directory swaps before returning any project files", async () => {
  const { root, app, project } = await fixture(); const script = path.join(root, "crash.mjs");
  await fs.writeFile(script, `import fs from 'node:fs/promises'; import {LearningApplication} from ${JSON.stringify(new URL("../src/learning-application.ts", import.meta.url).href)};
const app = await LearningApplication.open(${JSON.stringify(root)}); const rename = fs.rename.bind(fs);
fs.rename = async (from,to) => { await rename(from,to); if (String(from).endsWith('/files') && String(to).endsWith('/before')) process.exit(86); };
await app.projects.writeMany('rag', ${JSON.stringify(project.id)}, [{path:'new.md', expectedHash:null, content:'synthetic crash write'}],new AbortController().signal);`);
  await expect(promisify(execFile)(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(), timeout: 10_000, maxBuffer: 4000 })).rejects.toMatchObject({ code: 86 });
  const recovered = await app.projects.snapshot("rag", project.id); expect(recovered.treeHash).toBe(project.treeHash);
  expect((await fs.readdir(path.join(root, "zhixing/projects/rag", project.id))).filter(name => name.startsWith("change-"))).toEqual([]);
});
it("reuses a durable patch receipt after the outer task receipt is lost", async () => {
  const { app, project } = await fixture(); app.projects.select("rag", project.id);
  const taskId = crypto.randomUUID(); const tasks = new TaskExecutionStore(app.database); tasks.begin(taskId, "rag", "合成恢复");
  const tools = attachProjectTools(app, app.tools(false, { taskId, allowWrites: false, learningAccess: false }), "rag", taskId);
  const file = await app.projects.read("rag", project.id, "src/implementation.mjs");
  const input = { projectId: project.id, path: file.path, expectedHash: file.hash, replacements: [{ before: "value => value", after: "value => value + 0" }] };
  const context = { topicId: "rag", callId: "patch-one", maxRisk: "write" as const, signal: signal() };
  expect((await tools.harness.execute("project_patch", input, context)).ok).toBe(true);
  app.database.db.prepare("UPDATE assistant_operations SET status='running',result=NULL WHERE task_id=?").run(taskId);
  const again = await tools.harness.execute("project_patch", input, context); expect(again.ok).toBe(true);
  expect((await app.projects.snapshot("rag", project.id)).snapshots).toHaveLength(1);
});

it("terminates a non-cooperating Python test within its bounded execution budget", async () => {
  const started = Date.now();
  const result = await runPythonTests({ "test_loop.py": "while True: pass\n" }, ["test_loop.py"], signal(), 1000);
  if (process.platform === "darwin") expect(result.status).toBe("timed_out");
  else expect(result.status).toBe("unavailable");
  expect(Date.now() - started).toBeLessThan(4000);
});
it("advertises portable checkpoint title patterns and still rejects NUL and line breaks", async () => {
  const { app, project } = await fixture(); app.projects.select("rag", project.id); const taskId = crypto.randomUUID();
  const tools = attachProjectTools(app, app.tools(false, { taskId, allowWrites: false, learningAccess: false }), "rag", taskId);
  const schema = tools.definitions.find(tool => tool.name === "project_checkpoint")!.inputSchema as { properties: { title: { pattern: string } } };
  // The real DeepSeek endpoint rejects the legacy \\0 escape in JSON Schema regexes.
  expect(schema.properties.title.pattern).not.toContain("\\0");
  for (const [title, valid] of [["合成检查点", true], ["bad\nname", false], ["bad\rname", false], ["bad\0name", false]] as const) {
    const preview = () => tools.harness.preview("project_checkpoint", { projectId: project.id, expectedTreeHash: project.treeHash, title }, "rag");
    if (valid) expect(preview).not.toThrow(); else expect(preview).toThrow();
  }
});
