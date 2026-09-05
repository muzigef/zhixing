import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";

const exec = promisify(execFile);
const roots: string[] = [];
async function submitDay(root: string, day: string) { const app = await LearningApplication.open(root); try { for (const kind of ["implementation", "testOutput", "failureCase", "reflection"] as const) await app.submitEvidence("agent-development", day, kind, `这是 ${kind} 的实际记录，包含观察与具体结果。`); } finally { app.close(); } }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe.sequential("headless CLI workflow", () => {
  it("E01：在隔离根目录启动 Day 1 并写入当前主题记录", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const result = await exec("npx", ["tsx", "src/cli.ts", "开始第 1 天"], { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } });
    expect(result.stdout).toContain("今日目标");
    await expect(fs.access(path.join(root, "learning-notes", "topics", "agent-development", "daily", "D01.md"))).resolves.toBeUndefined();
  });

  it("E03–E06：Review、继续与源码导读在 CLI 闭环中遵守状态机", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command], options);
    await expect(invoke("开始第 2 天")).resolves.toMatchObject({ stdout: expect.stringContaining("D01") });
    await invoke("开始第 1 天");
    await expect(invoke("读源码 D01")).resolves.toMatchObject({ stdout: expect.stringContaining("不能读源码") });
    await expect(invoke("检查 D01 --实现 --测试")).resolves.toMatchObject({ stdout: expect.stringContaining("repair") });
    await expect(invoke("继续")).resolves.toMatchObject({ stdout: expect.stringContaining("下一步：继续 D01") });
    await expect(invoke("开始任务")).resolves.toMatchObject({ stdout: expect.stringContaining("开始 D01") });
    await expect(invoke("检查 D01 --实现 --测试 --失败 --复盘")).resolves.toMatchObject({ stdout: expect.stringContaining("repair") });
    await expect(invoke("提交证据 D01 reflection 今天验证了一个错误输入，下一步将添加边界测试。")).resolves.toMatchObject({ stdout: expect.stringContaining("已保存证据") });
    await submitDay(root, "D01");
    await expect(invoke("检查 D01")).resolves.toMatchObject({ stdout: expect.stringContaining("advance（8/8）") });
    await expect(invoke("读源码 D01")).resolves.toMatchObject({ stdout: expect.stringContaining("已解锁") });
  }, 12_000);

  it("E10：每个 headless CLI 命令写入同一 Run 的工具审计链", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    await exec("npx", ["tsx", "src/cli.ts", "主题列表"], { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } });
    const file = path.join(root, "zhixing", "data", "audit", "agent-development", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const events = (await fs.readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(["run_started", "tool_started", "tool_finished", "run_finished"]);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it("E13–E16：--topic 隔离 session，并在跨主题前置满足后启动 RAG", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } };
    const invoke = async (command: string, topic: string) => await exec("npx", ["tsx", "src/cli.ts", command, "--topic", topic], options);
    await expect(invoke("开始第 1 天", "rag")).resolves.toMatchObject({ stdout: expect.stringContaining("agent-development/D01") });
    await invoke("开始第 1 天", "agent-development");
    await submitDay(root, "D01");
    await invoke("检查 D01 --实现 --测试 --失败 --复盘", "agent-development");
    await invoke("开始第 2 天", "agent-development");
    await submitDay(root, "D02");
    await invoke("检查 D02 --实现 --测试 --失败 --复盘", "agent-development");
    await expect(invoke("开始第 1 天", "rag")).resolves.toMatchObject({ stdout: expect.stringContaining("rag/D01") });
    await expect(invoke("继续", "tool-calling")).resolves.toMatchObject({ stdout: expect.stringContaining("当前主题没有") });
    await expect(invoke("全部进度", "rag")).resolves.toMatchObject({ stdout: expect.stringContaining("rag：完成 0，进行中 1") });
  }, 15_000);

  it("E11/E19：显式禁用的 Codex 路由在 CLI 中降级到 mock", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command, "--topic", "rag"], options);
    const inbox = path.join(root, "zhixing", "inbox", "rag");
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, "source.md"), "# RAG\n\nRAG requires citations.", "utf8");
    await invoke("导入资料 rag/source.md");
    await invoke("模型切换 tutor codex-cli --确认");
    await expect(invoke("资料问答 RAG --允许外发")).resolves.toMatchObject({ stdout: expect.stringContaining("Mock：") });
  });

  it("E17/E20：模型列表不泄露凭证，角色切换只影响指定角色", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command], options);
    await expect(invoke("模型列表")).resolves.toMatchObject({ stdout: expect.stringMatching(/mock：healthy/) });
    await expect(invoke("模型切换 reviewer codex-cli --确认")).resolves.toMatchObject({ stdout: expect.stringContaining("reviewer -> codex-cli") });
    await expect(invoke("模型状态")).resolves.toMatchObject({ stdout: expect.stringMatching(/tutor -> mock[\s\S]*reviewer -> codex-cli[\s\S]*lab -> mock/) });
  });

  it("E30：备份预览与恢复仅接受确认后的备份文件", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command], options);
    const backup = await invoke("备份数据库");
    const file = /数据库备份完成：([^\n]+)/.exec(backup.stdout)?.[1];
    expect(file).toBeDefined();
    await expect(invoke(`备份预览 ${file}`)).resolves.toMatchObject({ stdout: expect.stringContaining("migrations=3") });
    await expect(invoke(`恢复数据库 ${file}`)).resolves.toMatchObject({ stdout: expect.stringContaining("需要明确确认") });
    await expect(invoke(`恢复数据库 ${file} --确认`)).resolves.toMatchObject({ stdout: expect.stringContaining("数据库恢复完成") });
  });

  it("E31：资料问答默认使用当前 tutor 路由", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command, "--topic", "rag"], options);
    const inbox = path.join(root, "zhixing", "inbox", "rag");
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, "privacy.md"), "# RAG\n\nRAG requires citations.", "utf8");
    await invoke("导入资料 rag/privacy.md");
    await expect(invoke("资料问答 RAG")).resolves.toMatchObject({ stdout: expect.stringContaining("Mock：") });
    await expect(invoke("资料问答 RAG --允许外发")).resolves.toMatchObject({ stdout: expect.stringContaining("Mock：") });
  });

  it("E40：画像、个性化计划、Skill 草案与资料概览无需配置任何模型", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-"));
    roots.push(root);
    const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } };
    const invoke = async (command: string) => await exec("npx", ["tsx", "src/cli.ts", command, "--topic", "rag"], options);
    await expect(invoke("设置学习画像 掌握 RAG 面试 --水平 初学 --每天 45 --周期 14")).resolves.toMatchObject({ stdout: expect.stringContaining("已保存学习画像") });
    const proposed = await invoke("生成个性化计划");
    const version = /个性化计划草案：(personal-plan-[^\n]+)/.exec(proposed.stdout)?.[1];
    expect(version).toBeDefined();
    await expect(invoke(`启用个性化计划 ${version} --确认`)).resolves.toMatchObject({ stdout: expect.stringContaining("已启用个性化计划") });
    await expect(invoke("生成技能草案 rag-interview")).resolves.toMatchObject({ stdout: expect.stringContaining("Skill 草案") });
    await expect(invoke("技能草案列表")).resolves.toMatchObject({ stdout: "rag-interview\n" });
    await expect(invoke("启用技能草案 rag-interview --确认")).resolves.toMatchObject({ stdout: expect.stringContaining("已启用主题 Skill") });
    await expect(invoke("技能列表 rag")).resolves.toMatchObject({ stdout: expect.stringContaining("rag-interview") });
    await expect(invoke("资料概览")).resolves.toMatchObject({ stdout: expect.stringContaining("资料：0 份") });
    await expect(invoke("学习建议")).resolves.toMatchObject({ stdout: expect.stringContaining("Mock：") });
  }, 10_000);
});
