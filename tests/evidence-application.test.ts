import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";

const roots: string[] = []; const apps: LearningApplication[] = [];
afterEach(async () => { apps.splice(0).forEach((app) => app.close()); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-evidence-")); roots.push(root); const app = await LearningApplication.open(root, process.cwd()); apps.push(app); await app.handle("开始第 1 天", "agent-development"); return { root, app }; }
it("reviews stored artifacts, distinguishes submitted reports, and detects changed bytes", async () => {
  const { root, app } = await fixture();
  expect(await app.review("agent-development", "D01")).toContain("repair");
  for (const kind of ["implementation", "testOutput", "failureCase", "reflection"] as const) await app.submitEvidence("agent-development", "D01", kind, `实际提交的 ${kind} 内容，包含输入、结果和解释。`);
  const result = await app.review("agent-development", "D01");
  expect(result).toContain("advance"); expect(result).toContain("未复跑"); expect(result).toContain("完整性");
  const evidence = await app.evidence.list("agent-development", "D01");
  await fs.writeFile(path.join(root, "learning-notes/topics/agent-development/evidence/D01", `${evidence.artifacts[0]!.id}.txt`), "被修改");
  expect(await app.review("agent-development", "D01")).toContain("repair");
  expect((await app.overview("agent-development")).days[0]?.state).toBe("进行中");
});
it("isolates evidence by topic/day and validates the course before any progress write", async () => {
  const { root, app } = await fixture();
  await expect(app.submitEvidence("rag", "D01", "reflection", "我的复盘与具体改进步骤")).rejects.toThrow("day_not_started");
  await expect(app.evidence.list("agent-development", "../D01")).rejects.toThrow();
  const plan = path.join(root, "zhixing/topics/tool-calling/PLAN.md");
  await fs.writeFile(plan, "---\ntopicId: tool-calling\ndays: invalid\n---\n");
  await expect(app.handle("开始第 1 天", "tool-calling")).rejects.toThrow("topic_plan_invalid");
  await expect(fs.access(path.join(root, "learning-notes/topics/tool-calling/daily/D01.md"))).rejects.toThrow();
});
it("runs staged JavaScript tests with artifact hashes and rejects an aborted validation", async () => {
  const { app } = await fixture();
  await app.submitEvidence("agent-development", "D01", "implementation", "export const add = (a, b) => a + b;");
  await app.submitEvidence("agent-development", "D01", "testScript", "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { add } from './implementation.mjs'; test('addition', () => assert.equal(add(1, 2), 3));");
  await expect(app.validateEvidence("agent-development", "D01", AbortSignal.abort())).rejects.toThrow();
  const result = await app.validateEvidence("agent-development", "D01", new AbortController().signal);
  if (process.platform === "darwin") { expect(result.status).toBe("completed"); expect(result.exitCode).toBe(0); expect(result.stdout).toContain("addition"); }
  else expect(result.status).toBe("unavailable");
  expect(result.implementationHash).toMatch(/^[a-f0-9]{64}$/);
});
