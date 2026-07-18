import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths.js";
import { MockModelClient } from "../src/model.js";
import { LearningRuntime } from "../src/runtime.js";
import { createDefaultTopicRegistry } from "../src/topics.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("mock evaluation", () => {
  it("E01/E02：列出主题并启动当前主题学习日", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-eval-"));
    roots.push(root);
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    expect(await runtime.handle("主题列表")).toContain("agent-development");
    const start = await runtime.handle("开始第 1 天");
    expect(start).toContain("D01");
    expect(start).toContain("今日目标");
    expect(start).toContain("4 小时安排");
    expect(start).toContain("完成证据");
    expect(start).toContain("开始任务");
    await expect(fs.access(path.join(root, "learning-notes", "topics", "agent-development", "daily", "D01.md"))).resolves.toBeUndefined();
  });

  it("E07：mock 模型响应可被取消", async () => {
    const controller = new AbortController();
    controller.abort();
    const consume = async (): Promise<void> => {
      for await (const _event of new MockModelClient().stream("test", controller.signal)) { void _event; }
    };
    await expect(consume()).rejects.toThrow("cancelled");
  });

  it("E03/E04/E06：缺证据不推进，完整证据推进，继续只给最小下一步", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-eval-"));
    roots.push(root);
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    await runtime.handle("开始第 1 天", "agent-development");
    await expect(runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: false, reflection: true })).resolves.toContain("repair");
    await expect(runtime.handle("继续", "agent-development")).resolves.toBe("下一步：为 D01 提交实现、测试输出、失败案例和复盘。");
    await expect(runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: true })).resolves.toContain("advance（8/8）");
    await expect(runtime.handle("开始第 2 天", "agent-development")).resolves.toContain("D02");
  });

  it("E05：未完成学习日不能进入源码导读", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-eval-"));
    roots.push(root);
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    await runtime.handle("开始第 1 天", "agent-development");
    expect(await runtime.handle("读源码 D01", "agent-development")).toContain("不能读源码");
    await runtime.reviewDay("agent-development", "D01", { implementation: true, testOutput: true, failureCase: true, reflection: true });
    expect(await runtime.handle("读源码 D01", "agent-development")).toContain("已解锁");
  });

  it("E16：全部进度只返回主题汇总", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-eval-"));
    roots.push(root);
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    const summary = await runtime.handle("全部进度", "rag");
    expect(summary).toContain("rag：完成 0，进行中 0");
    expect(summary).not.toContain("session");
    expect(summary).not.toContain("MISTAKES");
  });

  it("E13/E14：主题选择不会读取其他主题学习日", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-eval-"));
    roots.push(root);
    const runtime = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    expect(await runtime.handle("学习 rag")).toContain("rag");
    expect(await runtime.handle("进度", "rag")).toContain("尚未开始");
  });
});
