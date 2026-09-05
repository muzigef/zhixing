import { describe, expect, it } from "vitest";
import { ReplController, PromptAssembler } from "../src/repl-controller.js";
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
describe("responsive foreground conversation", () => {
  it("keeps ordinary messages ordered while reporting status immediately", async () => {
    const block = deferred(); const started: string[] = []; const notices: string[] = [];
    const queue = new ReplController({ execute: async (input) => { started.push(input); if (input === "first") await block.promise; }, interrupt: async () => { block.resolve(); }, status: (state) => { notices.push(`queued:${state.queued}`); }, notice: (text) => { notices.push(text); } });
    queue.submit("first"); queue.submit("second"); queue.submit("/status");
    expect(started).toEqual(["first"]); expect(notices).toContain("queued:1");
    block.resolve(); await queue.drain(); expect(started).toEqual(["first", "second"]);
  });
  it("stops an active reply immediately and applies steering before queued follow-ups", async () => {
    const block = deferred(); const started: string[] = []; let cancelled = 0;
    const queue = new ReplController({ execute: async (input) => { started.push(input); if (input === "解释梯度") await block.promise; }, canSteer: () => true, interrupt: async () => { cancelled++; block.resolve(); } });
    queue.submit("解释梯度"); queue.submit("再说应用"); queue.submit("等等，用生活例子解释");
    await queue.drain(); expect(cancelled).toBe(1);
    expect(started).toEqual(["解释梯度", "用生活例子解释", "再说应用"]);
  });
  it("does not interrupt state-changing work merely because a correction arrived", async () => {
    const block = deferred(); const started: string[] = []; let cancelled = false;
    const queue = new ReplController({ execute: async (input) => { started.push(input); if (input === "导入") await block.promise; }, canSteer: () => false, interrupt: async () => { cancelled = true; block.resolve(); } });
    queue.submit("导入"); queue.submit("/steer 请先解释");
    expect(cancelled).toBe(false); block.resolve(); await queue.drain(); expect(started).toEqual(["导入", "请先解释"]);
  });
  it("recovers after failures and caps queued input", async () => {
    const block = deferred(); const failures: unknown[] = []; const notices: string[] = [];
    const queue = new ReplController({ execute: async (input) => { if (input === "first") { await block.promise; throw new Error("fixture_failed"); } }, interrupt: async () => {}, error: (error) => { failures.push(error); }, notice: (text) => { notices.push(text); } });
    queue.submit("first"); for (let i = 0; i < 30; i++) queue.submit(`next${i}`);
    expect(queue.snapshot().queued).toBe(16); expect(notices.some((text) => text.includes("队列已满"))).toBe(true);
    block.resolve(); await queue.drain(); expect(failures).toHaveLength(1); expect(queue.snapshot().running).toBe(false);
  });
  it("stop is a control message and is never forwarded to the model", async () => {
    const block = deferred(); const started: string[] = [];
    const queue = new ReplController({ execute: async (input) => { started.push(input); await block.promise; }, interrupt: async () => { block.resolve(); } });
    queue.submit("first"); queue.submit("停止"); await queue.drain(); expect(started).toEqual(["first"]);
  });
});
describe("multiline prompts", () => {
  it("sends a pasted code block as one message only after /send", () => {
    const input = new PromptAssembler();
    expect(input.accept("/paste").kind).toBe("collecting");
    input.accept("帮我解释这段代码"); input.accept("```ts"); input.accept("const x = 1;"); input.accept("```");
    expect(input.accept("/send")).toEqual({ kind: "message", text: "帮我解释这段代码\n```ts\nconst x = 1;\n```" });
  });
  it("supports backslash continuation and cancellation without leaking buffer into the next input", () => {
    const input = new PromptAssembler();
    expect(input.accept("第一行\\").kind).toBe("collecting");
    expect(input.accept("第二行")).toEqual({ kind: "message", text: "第一行\n第二行" });
    input.accept("/paste"); input.accept("未发送"); input.cancel();
    expect(input.accept("新问题")).toEqual({ kind: "message", text: "新问题" });
  });
});
