import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { routeConversation } from "../src/conversation-routing.js";
import { interpretTeachingInput, resolveTeachingInput } from "../src/teaching-dialogue.js";
import { ResponseStyleStore } from "../src/response-style.js";
import { PathPolicy } from "../src/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("adaptive conversation decisions", () => {
  it.each(["解释大语言模型的注意力机制", "课程中的执行计划是什么意思？", "为什么删除节点会影响梯度？", "请说明如何创建主题", "给一个调整学习率的例子", "帮我创建一个 Transformer 模型", "用代码展示刚才的公式"])("keeps a knowledge question in teaching: %s", (input) => {
    expect(routeConversation(input, { teaching: true, planning: false })).toBe("teaching");
    expect(routeConversation(input, { teaching: false, planning: false })).toBe("answer");
  });
  it.each(["帮我调整当前学习计划", "我想创建一个新主题", "请把学习周期改成 14 天", "帮我做一个 RAG 学习计划", "我想学机器学习", "把模型切换到 deepseek"])("recognizes a management request: %s", (input) => {
    expect(routeConversation(input, { teaching: true, planning: false })).toBe("planning");
  });
  it("accepts planning details but allows questions while a draft is pending", () => {
    expect(routeConversation("把回答改成表格", { teaching: true, planning: true })).toBe("teaching");
    expect(routeConversation("用代码展示", { teaching: false, planning: true })).toBe("answer");
    expect(routeConversation("开始练习", { teaching: true, planning: true })).toBe("teaching");
    expect(routeConversation("给答案", { teaching: true, planning: true })).toBe("teaching");
    expect(routeConversation("零基础，每天45分钟，学14天", { teaching: false, planning: true })).toBe("planning");
    expect(routeConversation("先解释一下模型蒸馏", { teaching: true, planning: true })).toBe("teaching");
    expect(routeConversation("暂时不调整计划，解释一下梯度", { teaching: true, planning: true })).toBe("teaching");
  });
  it.each(["开始练习", "没有问题，开始练习", "来一道题", "我准备好了，出题吧", "出两道题", "给我一道应用题"])("starts practice without a classifier: %s", (input) => {
    expect(resolveTeachingInput(input, false)).toMatchObject({ action: { action: "start_practice" }, hasVerifiedSubmission: false });
  });
  it.each(["不要给答案，只给提示", "先别开始练习", "为什么这个答案不对？", "请解释这门课程中的模型", "答案是什么类型的数据？"])("does not turn a clarification into a solution or submission: %s", (input) => {
    expect(resolveTeachingInput(input, true)).toMatchObject({ action: { action: "ask_question" }, hasVerifiedSubmission: false });
  });
  it("uses the original target for direct solution/skip requests and classifies only ambiguous submissions", () => {
    expect(resolveTeachingInput("请直接给出第二题的参考答案", true)).toMatchObject({ action: { action: "request_solution" } });
    expect(resolveTeachingInput("换一道题", true)).toMatchObject({ action: { action: "skip_question" } });
    expect(resolveTeachingInput("协方差描述形状", true)).toBeUndefined();
    expect(resolveTeachingInput("协方差描述形状", false)).toMatchObject({ action: { action: "ask_question" } });
  });
  it.each(["给答案", "请告诉我正确答案", "给我这道题的解题思路"])("understands a direct request: %s", (input) => {
    expect(resolveTeachingInput(input, true)).toMatchObject({ action: { action: "request_solution" }, hasVerifiedSubmission: false });
  });
  it.each(["42", "B", "我的答案是 x=2"])("accepts an explicit short answer only with an active exercise: %s", (input) => {
    expect(resolveTeachingInput(input, true)).toMatchObject({ action: { action: "answer_question" }, hasVerifiedSubmission: true });
    expect(resolveTeachingInput(input, false)).toMatchObject({ action: { action: "ask_question" }, hasVerifiedSubmission: false });
  });
  it("does not let a classifier invent permission to start or skip an exercise", () => {
    expect(interpretTeachingInput('{"action":"start_practice"}', "解释一下刚才的例子")).toMatchObject({ action: { action: "ask_question" } });
    expect(interpretTeachingInput('{"action":"skip_question"}', "我还没明白")).toMatchObject({ action: { action: "ask_question" } });
  });
  it("does not accept an invented extension of the learner's words as a submission", () => {
    expect(interpretTeachingInput('{"action":"answer_question","learnerAnswer":"不知道但梯度等于两倍误差"}', "不知道")).toMatchObject({ hasVerifiedSubmission: false });
    expect(interpretTeachingInput('{"action":"answer_question","learnerAnswer":"协方差矩阵表示形状和方向"}', "协方差矩阵")).toMatchObject({ hasVerifiedSubmission: false });
  });
});

describe("per-topic answer preferences", () => {
  it("persists style across restarts without affecting other topics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-style-")); roots.push(root);
    const store = new ResponseStyleStore(new PathPolicy(root));
    expect(await store.load("rag")).toBe("adaptive");
    await store.save("rag", "concise");
    expect(await new ResponseStyleStore(new PathPolicy(root)).load("rag")).toBe("concise");
    expect(await store.load("agent-development")).toBe("adaptive");
    await expect(store.save("rag", "invalid" as "concise")).rejects.toThrow();
    expect(await store.load("rag")).toBe("concise");
  });
  it("rejects a symlinked preference file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-style-")); roots.push(root);
    const paths = new PathPolicy(root);
    await fs.mkdir(paths.topicDir("rag", "sessions"), { recursive: true });
    const outside = path.join(root, "outside.json");
    await fs.writeFile(outside, JSON.stringify({ topicId: "rag", style: "concise" }));
    await fs.symlink(outside, paths.resolveTopicPath("rag", "sessions", "response-style.json"));
    const store = new ResponseStyleStore(paths);
    await expect(store.load("rag")).rejects.toThrow("denied");
    await expect(store.save("rag", "detailed")).rejects.toThrow("denied");
  });
});
