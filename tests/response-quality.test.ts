import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { ContinuationText, inspectResponse, turnResponseRules } from "../src/response-quality.js";

const prior = "检索先找到可能相关的资料片段，再根据问题筛选候选。这一步只负责召回，并不能保证每个片段都能支持最终结论。\n\n";
it("focuses the current task's accuracy constraints without adding unrelated domains", () => {
  const math = turnResponseRules("请解释矩阵形式的线性回归梯度");
  expect(math).toContain("变化率"); expect(math).toContain("偏置");
  expect(math).not.toContain("资料限定");
  const sources = turnResponseRules("只依据资料正文说明没有覆盖的问题");
  expect(sources).toContain("资料限定"); expect(sources).toContain("逐条");
  expect(sources).not.toContain("偏置");
  const comparison = turnResponseRules("用两段比较两种方案");
  expect(comparison).toContain("恰好 2 段"); expect(comparison).toContain("实测");
  expect(turnResponseRules("谢谢")).toBe("");
});
it("removes an exact long repeated prefix across arbitrary stream chunks", () => {
  const gate = new ContinuationText(prior); let text = "";
  for (const chunk of [prior.slice(0, 8), prior.slice(8, 40), prior.slice(40) + "重排", "会进一步比较相关性。"]) text += gate.push(chunk);
  text += gate.finish(); expect(text).toBe("重排会进一步比较相关性。"); expect(gate.removed).toBe(prior.length);
});
it("releases partial overlap on interruption and does not cut math, code, or short repetition", () => {
  for (const source of ["重复很短。", `${prior}\n\`\`\`ts\nconst x = 1;`, `${prior}\n$$\nx^2`, `${prior}\n\`\`\`ts\nx\n\`\`\``]) {
    const gate = new ContinuationText(source); expect(gate.push(source + "继续") + gate.finish()).toBe(source + "继续");
  }
  const gate = new ContinuationText(prior); expect(gate.push(prior.slice(0, 20))).toBe(""); expect(gate.finish()).toBe(prior.slice(0, 20));
});
it("diagnoses observable format/citation problems without changing formula or code contents", () => {
  const text = "结论见 [1]。\n\\frac{a}{b}\n```ts\nconst x = 1;";
  expect(inspectResponse(text, "请用两段说明", []).map(d => d.code)).toEqual(expect.arrayContaining(["unclosed_code", "bare_latex", "unverified_citation", "paragraph_count"]));
  expect(inspectResponse("$$\n\\frac{a}{b}\n$$\n\n读作 a 除以 b。\n\n```latex\n\\frac{a}{b}\n```", "", [])).toEqual([]);
});
it("keeps displayed deltas, saved answer, final item and restart consistent after continuation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-quality-"));
  try {
    const store = new AgentSessionStore(root); const service = new AgentService(store, () => ({ async *stream() { for (const text of [prior.slice(0, 20), prior.slice(20), "下一步是重排。"]) yield { type: "text_delta", text }; yield { type: "done" }; } }));
    const session = await service.create(); session.messages.push({ id: randomUUID(), role: "user", text: "解释 RAG", status: "completed", createdAt: new Date().toISOString() }, { id: randomUUID(), role: "assistant", text: prior, status: "interrupted", createdAt: new Date().toISOString() }); await store.save(session);
    let visible = ""; service.subscribe(event => { if (event.type === "delta") visible += event.text; });
    await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", text: "继续回答" }); await service.idle();
    const answer = (await store.load(session.id)).messages.at(-1)!;
    expect(visible).toBe("下一步是重排。"); expect(answer.text).toBe(visible); expect(answer.items?.find(item => item.kind === "final")).toMatchObject({ text: visible });
    expect(answer.quality?.some(item => item.code === "continuation_repeat_removed")).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("makes explicit paragraph and continuation constraints visible next to the current request", async () => {
  const { buildMessages } = await import("../src/learning-agent-profile.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-turn-rules-"));
  try {
    const session = await new AgentSessionStore(root).create();
    session.messages.push({ id: randomUUID(), role: "assistant", text: prior, status: "interrupted", createdAt: new Date().toISOString() });
    for (const [question, expected] of [["继续回答", "不要从第一个步骤重新开始"], ["只写两段解释缓存", "恰好 2 段正文"]]) {
      const messages = buildMessages(session, { sessionId: session.id, provider: "mock", style: "adaptive", text: question! });
      expect(messages.at(-2)).toMatchObject({ role: "system", content: expect.stringContaining(expected!) });
      expect(messages.at(-1)).toEqual({ role: "user", content: question });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("detects inline display delimiters and individual unmatched source markers while ignoring code examples", () => {
  expect(inspectResponse("$$x^2$$", "", [])).toContainEqual(expect.objectContaining({ code: "math_layout" }));
  expect(inspectResponse("已核验 [a.md#anchor=a] 与未知 [b.md#anchor=b]", "", ["[a.md#anchor=a]"])).toContainEqual(expect.objectContaining({ code: "unverified_citation" }));
});

it("normalizes display delimiters without changing math contents or fenced source code", async () => {
  const { normalizeDisplayMath } = await import("../src/response-quality.js");
  expect(normalizeDisplayMath("$$x^2+1$$\n\n```latex\n$$x^2+1$$\n```" )).toBe("$$\nx^2+1\n$$\n\n```latex\n$$x^2+1$$\n```");
});
it("normalizes complete multiline display wrappers while preserving ambiguous or literal source", async () => {
  const { normalizeDisplayMath } = await import("../src/response-quality.js");
  const formula = String.raw`L(w,b)=\frac{1}{2n}\sum_i e_i^2
=\frac{1}{2n}\sum_i(wx_i+b-y_i)^2`;
  const expected = `$$\n${formula}\n$$`;
  for (const source of [`$$${formula}$$`, `$$\n${formula}$$`, `$$${formula}\n$$`, expected]) {
    expect(normalizeDisplayMath(source)).toBe(expected);
    expect(normalizeDisplayMath(normalizeDisplayMath(source))).toBe(expected);
  }
  for (const source of ["正文 $$x\ny$$ 尾文", "$$x\ny", "`$$x$$`", "    $$x$$", "~~~latex\n$$x\ny$$\n~~~", "$$x\n```latex\ny$$\n```", "$$x$$ 与 $$y$$"]) {
    expect(normalizeDisplayMath(source)).toBe(source);
  }
  const oversized = `$$${"x".repeat(63_997)}$$`;
  expect(normalizeDisplayMath(oversized)).toBe(oversized);
});
it("persists the same normalized math in shared service patches, final items and reloaded history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-math-layout-"));
  try {
    const store = new AgentSessionStore(root);
    const source = "$$x^2\n+1$$"; const expected = "$$\nx^2\n+1\n$$";
    const service = new AgentService(store, () => ({ async *stream() { yield { type: "text_delta", text: source }; yield { type: "done" }; } }));
    const session = await service.create(); let lastText: string | undefined;
    service.subscribe(event => { if (event.type === "message_patch" && event.changes.text !== undefined) lastText = event.changes.text; });
    await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", text: "解释公式" }); await service.idle();
    const answer = (await store.load(session.id)).messages.at(-1)!;
    expect(lastText).toBe(expected); expect(answer.text).toBe(expected);
    expect(answer.items?.find(item => item.kind === "final")).toMatchObject({ text: expected });
    expect(answer.quality).not.toContainEqual(expect.objectContaining({ code: "math_layout" }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("retries an empty continuation once and never reports it as a completed answer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-empty-continuation-"));
  try {
    let turns = 0;
    const client = { async *stream() { turns++; yield { type: "text_delta" as const, text: "continue" }; yield { type: "done" as const }; }, async *continue() { turns++; yield { type: "text_delta" as const, text: "接下来的步骤需要核对来源是否支持结论。" }; yield { type: "done" as const }; } };
    const service = new AgentService(new AgentSessionStore(root), () => client); const session = await service.create();
    await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", text: "继续回答" }); await service.idle();
    expect(turns).toBe(2); expect((await service.load(session.id)).messages.at(-1)).toMatchObject({ status: "completed", text: "接下来的步骤需要核对来源是否支持结论。" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
