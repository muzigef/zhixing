import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolHarness } from "../src/tool-harness.js";

describe("ToolHarness", () => {
  it("does not start side effects after cancellation", async () => {
    const harness = new ToolHarness();
    let executed = false;
    harness.register({ name: "write", input: z.object({}), risk: "write", timeoutMs: 100, idempotent: false, execute: async () => { executed = true; return "written"; } });
    const controller = new AbortController(); controller.abort();
    await expect(harness.execute("write", {}, { topicId: "rag", signal: controller.signal, maxRisk: "write" })).resolves.toMatchObject({ ok: false, errorCode: "tool_cancelled" });
    expect(executed).toBe(false);
  });
  it("rejects cross-topic input before Zod strips unknown fields", async () => {
    const harness = new ToolHarness();
    let executed = false;
    harness.register({ name: "lookup", input: z.object({}), risk: "read", timeoutMs: 100, idempotent: true, execute: async () => { executed = true; } });
    await expect(harness.execute("lookup", { topicId: "other" }, { topicId: "rag", signal: new AbortController().signal })).resolves.toMatchObject({ ok: false, errorCode: "cross_topic_denied" });
    expect(executed).toBe(false);
  });
  it("accepts void results without converting successful work into failure", async () => {
    const harness = new ToolHarness();
    harness.register({ name: "noop", input: z.object({}), risk: "read", timeoutMs: 100, idempotent: true, execute: async () => undefined });
    await expect(harness.execute("noop", {}, { topicId: "rag", signal: new AbortController().signal })).resolves.toMatchObject({ ok: true, output: null });
  });
  it("enforces schemas and blocks unknown tools", async () => {
    const harness = new ToolHarness();
    harness.register({ name: "echo", input: z.object({ value: z.string().max(8) }), risk: "read", timeoutMs: 100, idempotent: true, execute: async ({ value }) => ({ value }) });
    const context = { topicId: "rag" as const, signal: new AbortController().signal };
    await expect(harness.execute("missing", {}, context)).resolves.toMatchObject({ ok: false, errorCode: "tool_not_allowed" });
    await expect(harness.execute("echo", { value: 2 }, context)).resolves.toMatchObject({ ok: false, errorCode: "tool_input_invalid" });
    await expect(harness.execute("echo", { value: "ok" }, context)).resolves.toMatchObject({ ok: true, output: { value: "ok" } });
  });
  it("bounds oversized results", async () => {
    const harness = new ToolHarness();
    harness.register({ name: "large", input: z.object({}), risk: "read", timeoutMs: 100, idempotent: true, execute: async () => "x".repeat(13_000) });
    await expect(harness.execute("large", {}, { topicId: "rag", signal: new AbortController().signal })).resolves.toMatchObject({ ok: true, output: { truncated: true } });
  });
  it("enforces the control-plane capability before a tool can run", async () => {
    const harness = new ToolHarness();
    harness.register({ name: "write_note", input: z.object({ text: z.string() }), risk: "write", timeoutMs: 100, idempotent: false, execute: async () => "never" });
    await expect(harness.execute("write_note", { text: "x" }, { topicId: "rag", signal: new AbortController().signal, maxRisk: "read" })).resolves.toMatchObject({ ok: false, errorCode: "tool_policy_denied" });
  });
  it("enforces its deadline even when a tool ignores AbortSignal", async () => {
    const harness = new ToolHarness();
    harness.register({ name: "hung", input: z.object({}), risk: "read", timeoutMs: 5, idempotent: true, execute: async () => await new Promise<string>((resolve) => setTimeout(() => resolve("too late"), 50)) });
    await expect(harness.execute("hung", {}, { topicId: "rag", signal: new AbortController().signal })).resolves.toMatchObject({ ok: false, errorCode: "tool_timeout" });
  });
});
