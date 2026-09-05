import { describe, expect, it } from "vitest";
import { LoopGuard } from "../src/loop-guard.js";

describe("loop guard", () => {
  it("detects equivalent arguments regardless of object key order", () => {
    const guard = new LoopGuard();
    expect(guard.recordToolCall("search", { q: "rag", options: { a: 1, b: 2 } })).toBeUndefined();
    expect(guard.recordToolCall("search", { options: { b: 2, a: 1 }, q: "rag" })).toBe("repeated_tool_call");
  });
  it("在最大轮次后停止", () => {
    const guard = new LoopGuard(2);
    expect(guard.nextTurn()).toBeUndefined();
    expect(guard.nextTurn()).toBeUndefined();
    expect(guard.nextTurn()).toBe("max_turns");
  });

  it("检测重复工具调用", () => {
    const guard = new LoopGuard();
    expect(guard.recordToolCall("search", { q: "rag" })).toBeUndefined();
    expect(guard.recordToolCall("search", { q: "rag" })).toBe("repeated_tool_call");
  });
});
