import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { TeachingSessionStore } from "../src/teaching-session-store.js";
import { ConversationSessionStore } from "../src/conversation-session.js";
import { PathPolicy } from "../src/paths.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const answer = '## 注意力\n\n**先看结论**：模型按相关性组合信息。\n\n```ts\nconst score = 1;\n```\n\n用中文解释每个变量。';
async function setup(teaching: "answer_questions" | "practice" | false = false, responses: Array<string | { text: string; partial?: boolean; stall?: boolean }> = [answer]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-interaction-cli-")); roots.push(root);
  const settings = path.join(root, "zhixing", "settings"); await fs.mkdir(settings, { recursive: true });
  await fs.writeFile(path.join(settings, "model-routing.local.json"), JSON.stringify({ routes: { tutor: "deepseek-api", reviewer: "mock", lab: "mock" } }));
  const sessions = new TeachingSessionStore(new PathPolicy(root));
  if (teaching) await sessions.save("agent-development", { dayId: "D01", dayCard: "第1天：理解注意力", stage: teaching, quizRound: teaching === "practice" ? 1 : 0, currentExercise: teaching === "practice" ? "第一题：解释注意力。" : undefined, transcript: ["教师：上次只解释了查询向量。"] });
  const fixture = path.join(root, "provider-fixture.mjs");
  const requestsFile = path.join(root, "requests.json");
  const keychainModule = new URL("../src/macos-keychain.ts", import.meta.url).href;
  await fs.writeFile(fixture, `
import fs from 'node:fs/promises';
import { MacOSKeychainSecretStore } from ${JSON.stringify(keychainModule)};
MacOSKeychainSecretStore.prototype.get = async () => 'fixture-key';
const responses = ${JSON.stringify(responses)};
let requests = [];
try { requests = JSON.parse(await fs.readFile(${JSON.stringify(requestsFile)}, 'utf8')); } catch {}
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body); requests.push(body);
  await fs.writeFile(${JSON.stringify(requestsFile)}, JSON.stringify(requests));
  const reply = responses[Math.min(requests.length - 1, responses.length - 1)];
  const content = typeof reply === 'string' ? reply : reply.text;
  let stream = '';
  for (let i = 0; i < content.length; i += 7) stream += 'data: ' + JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + 7) } }] }) + '\\n\\n';
  if (!reply.partial && !reply.stall) stream += 'data: [DONE]\\n\\n';
  if (reply.stall) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); } }), { headers: { 'content-type': 'text/event-stream' } });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
};
`);
  const args = ["--import", "tsx", "--import", fixture, "src/cli.ts"];
  const options = { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "1", NO_COLOR: "1" } };
  return {
    root, sessions, chats: new ConversationSessionStore(new PathPolicy(root)),
    controlledRepl: (initial: string, trigger: string, next: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...args, "--repl"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
      let output = ""; let errors = ""; let sent = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error("fixture_control_timeout")); }, 8_000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (!sent && output.includes(trigger)) { sent = true; child.stdin.end(next.join("\n") + "\n"); }
      });
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); if (code) reject(new Error(errors)); else resolve(output + errors); });
      child.stdin.write(initial + "\n");
    }),
    requests: async () => JSON.parse(await fs.readFile(requestsFile, "utf8")) as Array<{ messages: Array<{ content: string }> }>,
    invoke: (command: string, topic = "agent-development") => exec(process.execPath, [...args, command, "--topic", topic], options),
    interruptedRepl: () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...args, "--repl"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
      let output = ""; let errors = ""; let cancelled = false; let resumed = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error("fixture_cancel_timeout")); }, 10_000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (!cancelled && output.includes("未完成的段落")) { cancelled = true; child.kill("SIGINT"); }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
        if (!resumed && errors.includes("已停止本轮回答")) { resumed = true; child.stdin.end("换个例子\n退出\n"); }
      });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); if (code) reject(new Error(errors)); else resolve(output + errors); });
      child.stdin.write("解释注意力\n");
    }),
    repl: (lines: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...args, "--repl", "--topic", "agent-development"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
      let output = ""; let errors = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("fixture_repl_timeout")); }, 15_000);
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); if (code || errors.includes("操作未完成")) reject(new Error(errors)); else resolve(output); });
      child.stdin.end(lines.join("\n") + "\n");
    }),
  };
}

describe("natural interaction through the actual CLI", () => {
  it("answers a knowledge question without requiring a learning plan", async () => {
    const fixture = await setup();
    const result = await fixture.invoke("解释大语言模型的注意力机制");
    expect(result.stdout.trim()).toBe(answer);
    expect(await fixture.requests()).toHaveLength(1);
    expect(await fixture.sessions.load("agent-development")).toBeUndefined();
  });
  it("retains a lesson and sends one copy of the question without a classification round", async () => {
    const fixture = await setup("answer_questions");
    const question = "解释课程中大语言模型的注意力机制";
    expect((await fixture.invoke(question)).stdout.trim()).toBe(answer);
    const requests = await fixture.requests(); expect(requests).toHaveLength(1);
    const prompt = requests[0]!.messages[0]!.content;
    expect(prompt.split(question)).toHaveLength(2);
    expect(prompt).toContain("上次只解释了查询向量");
    expect(prompt).not.toContain("结尾必须询问");
    expect(await fixture.sessions.load("agent-development")).toMatchObject({ stage: "answer_questions", quizRound: 0, transcript: expect.arrayContaining([`用户：${question}`]) });
  });
  it("starts an exercise directly and retains it after a solution request", async () => {
    const fixture = await setup("answer_questions", ["第一题：用自己的话解释注意力。", "参考答案：注意力按相关性加权信息。"]);
    expect((await fixture.invoke("来一道题")).stdout).toContain("第一题");
    expect((await fixture.invoke("直接给出第一题答案")).stdout).toContain("参考答案");
    expect(await fixture.requests()).toHaveLength(2);
    expect(await fixture.sessions.load("agent-development")).toMatchObject({ stage: "practice", quizRound: 1, currentExercise: "第一题：用自己的话解释注意力。", learnerAttempts: [] });
  });
  it("keeps a restored teaching mode across restart after opening a new chat", async () => {
    const fixture = await setup("answer_questions");
    await fixture.invoke("/new");
    expect((await fixture.invoke("开始任务")).stdout).toContain("当前教学已在 D01");
    expect((await fixture.chats.current("agent-development"))?.mode).toBe("lesson");
    await fixture.invoke("举个例子");
    expect((await fixture.requests())[0]!.messages[0]!.content).toContain("上次只解释了查询向量");
  });
  it("remembers explicit style per topic across CLI processes", async () => {
    const fixture = await setup();
    expect((await fixture.invoke("/style concise")).stdout).toContain("简洁");
    await fixture.invoke("解释注意力");
    await fixture.invoke("解释注意力", "rag");
    const requests = await fixture.requests(); expect(requests).toHaveLength(2);
    expect(requests[0]!.messages[0]!.content).toContain("回答风格：简洁");
    expect(requests[1]!.messages[0]!.content).toContain("回答风格：适中");
  });
  it("processes queued REPL turns, preserves history, and streams each answer only once", async () => {
    const fixture = await setup(false, [answer, "例如，查询向量可以代表你正在找的信息。"]);
    const output = await fixture.repl(["解释注意力", "举个例子", "退出"]);
    expect(output.split("模型按相关性组合信息")).toHaveLength(2);
    expect(output).toContain("查询向量可以代表");
    expect(output).not.toContain("本轮教学完成");
    const requests = await fixture.requests(); expect(requests).toHaveLength(2);
    expect(requests[1]!.messages[0]!.content).toContain("模型按相关性组合信息");
    expect(requests[1]!.messages[0]!.content.split("举个例子")).toHaveLength(2);
  });
  it("allows a knowledge question while a plan is pending, then cancels the draft locally", async () => {
    const proposal = JSON.stringify({ kind: "proposal", topicId: "agent-development", summary: "查看进度", actions: [{ type: "command", command: "进度" }] });
    const fixture = await setup("answer_questions", [proposal, answer]);
    const output = await fixture.repl(["帮我调整学习计划", "先解释一下大语言模型", "取消草案", "直接运行", "退出"]);
    expect(output).toContain("待执行草案");
    expect(output).toContain("模型按相关性组合信息");
    expect(output).toContain("已取消待执行草案");
    expect(output).toContain("没有待执行草案");
    expect(await fixture.requests()).toHaveLength(2);
    expect(await fixture.sessions.load("agent-development")).toMatchObject({ stage: "answer_questions", quizRound: 0 });
  });
  it("starts a lesson with adaptive depth and mathematical formatting instructions", async () => {
    const fixture = await setup();
    const result = await fixture.invoke("开始第 1 天");
    expect(result.stdout).toContain(answer);
    const prompt = (await fixture.requests())[0]!.messages[0]!.content;
    expect(prompt).not.toContain("800");
    expect(prompt).not.toContain("不少于");
    expect(prompt).toContain("$$");
    expect(prompt).toContain("分子");
    expect(result.stdout).not.toContain("没有问题，开始练习");
  });
  it("keeps short course overviews within their configured duration", async () => {
    const proposal = JSON.stringify({ kind: "proposal", topicId: "agent-development", summary: "一天入门", actions: [
      { type: "set_learning_profile", goal: "理解注意力机制", level: "初学", dailyMinutes: 45, totalDays: 1 },
      { type: "generate_custom_course" },
    ] });
    const fixture = await setup(false, [proposal]);
    const output = await fixture.repl(["帮我制定一天的学习计划", "直接运行", "退出"]);
    const ranges = [...output.matchAll(/第 (\d+)–(\d+) 天/g)];
    expect(ranges.map((range) => [Number(range[1]), Number(range[2])])).toEqual([[1, 1]]);
  });

  it("keeps a partial exercise at its previous checkpoint and flushes the final stream fragment", async () => {
    const fixture = await setup("answer_questions", [{ text: "尚未生成完整题目", partial: true }]);
    const output = await fixture.repl(["开始练习", "退出"]);
    expect(output.split("尚未生成完整题目")).toHaveLength(2);
    expect(output).toContain("回答未完成");
    expect(await fixture.sessions.load("agent-development")).toMatchObject({ stage: "answer_questions", quizRound: 0 });
  });
  it("cancels a streaming reply and accepts another turn in the same REPL", async () => {
    const fixture = await setup("answer_questions", [{ text: "未完成的段落。\n", stall: true }, "新的具体例子。"]);
    const output = await fixture.interruptedRepl();
    expect(output).toContain("已停止本轮回答");
    expect(output).toContain("新的具体例子");
    const session = await fixture.sessions.load("agent-development");
    expect(session?.transcript.join("\n")).not.toContain("未完成的段落");
    expect(session?.transcript.join("\n")).toContain("新的具体例子");
  });

  it("shows concrete plan parameters and invalidates the old draft if a revision fails", async () => {
    const proposal = JSON.stringify({ kind: "proposal", topicId: "agent-development", summary: "入门安排", actions: [
      { type: "set_learning_profile", goal: "理解注意力机制", level: "初学", dailyMinutes: 45, totalDays: 14 },
      { type: "generate_custom_course" },
    ] });
    const fixture = await setup(false, [proposal, "invalid proposal"]);
    const output = await fixture.repl(["帮我制定学习计划", "/plan 怎么把它缩短到一天", "直接运行", "退出"]);
    expect(output).toContain("理解注意力机制");
    expect(output).toContain("每天 45 分钟");
    expect(output).toContain("14 天");
    expect(output).toContain("没有待执行草案");
    expect(await fixture.requests()).toHaveLength(2);
  });

  it("resumes ordinary chat after restart and understands continue as a follow-up", async () => {
    const fixture = await setup(false, ["注意力通过查询和键计算相关性。", "接下来解释加权求和。"]);
    await fixture.invoke("解释注意力");
    expect((await fixture.invoke("继续")).stdout).toContain("接下来解释加权求和");
    const requests = await fixture.requests(); expect(requests).toHaveLength(2);
    expect(requests[1]!.messages[0]!.content).toContain("通过查询和键计算相关性");
  });
  it("starts a fresh chat and can resume the earlier one without leaking across topics", async () => {
    const fixture = await setup(false, ["旧会话的查询向量。", "新会话内容。", "继续旧会话。"]);
    await fixture.invoke("解释查询向量");
    const previous = (await fixture.chats.current("agent-development"))!;
    expect((await fixture.invoke("/new")).stdout).toContain("新对话");
    await fixture.invoke("解释索引");
    expect((await fixture.requests())[1]!.messages[0]!.content).not.toContain("旧会话的查询向量");
    await fixture.invoke(`/resume ${previous.id}`);
    await fixture.invoke("继续");
    expect((await fixture.requests())[2]!.messages[0]!.content).toContain("旧会话的查询向量");
    expect(await fixture.chats.current("rag")).toBeUndefined();
  });
  it("shows text without a newline, handles status immediately, and steers using interrupted context", async () => {
    const fixture = await setup(false, [{ text: "查询向量的未完成解释", stall: true }, "换成生活例子解释。"]);
    const output = await fixture.controlledRepl("解释查询向量", "查询向量的未完成解释", ["/status", "等等，用生活例子", "退出"]);
    expect(output).toContain("正在回答");
    expect(output).toContain("换成生活例子解释");
    const requests = await fixture.requests(); expect(requests).toHaveLength(2);
    expect(requests[1]!.messages[0]!.content).toContain("查询向量的未完成解释");
    expect(requests[1]!.messages[0]!.content).toContain("用户：解释查询向量");
    expect((await fixture.chats.current("agent-development"))?.turns[0]?.status).toBe("interrupted");
  });
  it("stops immediately with a natural stop request, without another provider call", async () => {
    const fixture = await setup(false, [{ text: "正在展示的内容", stall: true }]);
    const output = await fixture.controlledRepl("解释注意力", "正在展示的内容", ["停止", "退出"]);
    expect(output).toContain("已停止本轮回答");
    expect(await fixture.requests()).toHaveLength(1);
  });
  it("submits multiline pasted content as a single request", async () => {
    const fixture = await setup();
    await fixture.repl(["/paste", "解释下面代码", "```ts", "const x = 1;", "```", "/send", "退出"]);
    const requests = await fixture.requests(); expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[0]!.content).toContain("解释下面代码\n```ts\nconst x = 1;\n```");
  });
  it("uses natural approval for a reviewed plan without asking for a fixed command", async () => {
    const proposal = JSON.stringify({ kind: "proposal", topicId: "agent-development", summary: "检查进度", actions: [{ type: "command", command: "进度" }] });
    const fixture = await setup(false, [proposal]);
    const output = await fixture.repl(["帮我调整计划", "就按这个来", "退出"]);
    expect(output).toContain("agent-development");
    expect(await fixture.requests()).toHaveLength(1);
  });

});
