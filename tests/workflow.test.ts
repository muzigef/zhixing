import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { PathPolicy } from "../src/paths.js";
import { LearningRuntime } from "../src/runtime.js";
import { createDefaultTopicRegistry } from "../src/topics.js";

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-workflow-"));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("B02 audit and B03 reviewer workflow", () => {
  it("脱敏审计按 topicId/runId/seq 写入 JSONL", async () => {
    const root = await temporaryRoot();
    const logger = new AuditLogger(new PathPolicy(root), () => new Date("2026-01-02T03:04:05.000Z"));
    const run = logger.createRun("rag", "search_library");
    await run.start();
    await run.fail(`Bearer ${"secret-value"} user@example.com /Users/name/private.pdf`);
    const content = await fs.readFile(path.join(root, "zhixing", "data", "audit", "rag", "2026-01-02.jsonl"), "utf8");
    expect(content).toContain('"seq":1');
    expect(content).toContain('"seq":2');
    expect(content).toContain("[REDACTED_CREDENTIAL]");
    expect(content).not.toContain("secret-value");
    expect(content).not.toContain("user@example.com");
    await logger.appendModel("rag", "run-model", 3, "deepseek-api", "tutor", 12, "success");
    const modelContent = await fs.readFile(path.join(root, "zhixing", "data", "audit", "rag", "2026-01-02.jsonl"), "utf8");
    expect(modelContent).toContain("model:deepseek-api:tutor");
    expect(modelContent).toContain("durationMs=12;status=success");
  });

  it("重建 Runtime 后继续恢复当前主题 session", async () => {
    const root = await temporaryRoot();
    await new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root)).handle("开始第 1 天", "agent-development");
    const restored = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    await expect(restored.handle("继续", "agent-development")).resolves.toContain("D01");
  });

  it("跨主题前置 Day 未完成时拒绝开始 RAG", async () => {
    const root = await temporaryRoot();
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    expect(await runtime.handle("开始第 1 天", "rag")).toContain("agent-development/D01");
    await runtime.handle("开始第 1 天", "agent-development");
    await runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: true });
    expect(await runtime.handle("开始第 1 天", "rag")).toContain("agent-development/D02");
  });

  it("Topic Plan 的 requiredEvidence 决定 Reviewer 门槛", async () => {
    const root = await temporaryRoot();
    const plan = path.join(root, "zhixing", "topics", "rag", "PLAN.md");
    await fs.mkdir(path.dirname(plan), { recursive: true });
    await fs.writeFile(plan, "---\nrequiredEvidence: [implementation, test-output, failure-case]\n---\n# RAG\n", "utf8");
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    await runtime.handle("开始第 1 天", "agent-development");
    await runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: true });
    await runtime.handle("开始第 2 天", "agent-development");
    await runtime.reviewDay("agent-development", "D02", { implementation: true, testOutput: true, failureCase: true, reflection: true });
    await runtime.handle("开始第 1 天", "rag");
    await expect(runtime.reviewDay("rag", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: false })).resolves.toContain("advance");
  });

  it("计划调整先创建草案，显式启用后才替换 active plan", async () => {
    const root = await temporaryRoot();
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    const proposal = await runtime.proposePlan("rag", 90);
    const version = /plan-[\dTZ-]+/.exec(proposal)?.[0];
    expect(version).toBeDefined();
    await expect(fs.access(path.join(root, "learning-notes", "topics", "rag", "ACTIVE_PLAN.md"))).rejects.toThrow();
    await expect(runtime.activatePlan("rag", version ?? "")).resolves.toContain("已启用");
    const active = await fs.readFile(path.join(root, "learning-notes", "topics", "rag", "ACTIVE_PLAN.md"), "utf8");
    expect(active).toContain("每日预算：90 分钟");
    expect(active).toContain("状态：已启用");
    await expect(runtime.createReviewPlan("rag")).resolves.toContain("复习计划");
  });

  it("Reviewer 缺少证据不推进，完整证据原子完成并解锁下一 Day", async () => {
    const root = await temporaryRoot();
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    expect(await runtime.handle("开始第 2 天", "agent-development")).toContain("D01");
    await runtime.handle("开始第 1 天", "agent-development");
    expect(await runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: false, reflection: false })).toContain("repair");
    expect(await runtime.handle("开始第 2 天", "agent-development")).toContain("D01");
    expect(await runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: true })).toContain("advance");
    expect(await runtime.handle("开始第 2 天", "agent-development")).toContain("今日目标");
    const progress = await fs.readFile(path.join(root, "learning-notes", "topics", "agent-development", "PROGRESS.md"), "utf8");
    expect(progress).toContain("| D01 | 完成 | 8/8 |");
  });
});
