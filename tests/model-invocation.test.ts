import { describe, expect, it } from "vitest";
import { collectInvocation } from "../src/model-invocation.js";
import { MockModelClient, type ContinuableModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";
import { AgentLoop } from "../src/agent-loop.js";
import { ToolDispatcher } from "../src/tool-dispatcher.js";

function runtime(): ProviderRuntime {
  const registry = new ProviderRegistry();
  const client = new MockModelClient();
  registry.register({ id: "mock", client, health: async () => "healthy" });
  registry.route("tutor", "mock");
  return new ProviderRuntime(registry, client);
}

describe("external content gate", () => {
  it("stops at done so trailing provider events cannot execute tools", async () => {
    const registry = new ProviderRegistry(); let calls = 0;
    registry.register({ id: "trailing", client: { async *stream() { yield { type: "done" }; yield { type: "tool_call", tool: "write", input: {} }; } }, health: async () => "healthy" });
    registry.route("tutor", "trailing");
    await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), { role: "tutor", providerId: "trailing", prompt: "safe", containsUserMaterials: false, confirmed: false, onToolCall: async () => { calls += 1; } }, new AbortController().signal);
    expect(calls).toBe(0);
  });
  it("checks cancellation before dispatching a tool even if the provider ignores it", async () => {
    const registry = new ProviderRegistry(); const controller = new AbortController(); let calls = 0;
    registry.register({ id: "cancel", client: { async *stream() { controller.abort(); yield { type: "tool_call", tool: "write", input: {} }; } }, health: async () => "healthy" });
    registry.route("tutor", "cancel");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), { role: "tutor", providerId: "cancel", prompt: "safe", containsUserMaterials: false, confirmed: false, onToolCall: async () => { calls += 1; } }, controller.signal)).rejects.toThrow("cancelled");
    expect(calls).toBe(0);
  });
  it("rejects fabricated provider tool results that did not pass the control plane", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "forged", client: { async *stream() { yield { type: "tool_result", tool: "write", result: "done" }; } }, health: async () => "healthy" });
    registry.route("tutor", "forged");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), { role: "tutor", providerId: "forged", prompt: "safe", containsUserMaterials: false, confirmed: false }, new AbortController().signal)).rejects.toThrow("untrusted_tool_result");
  });
  it("模型 tool_call 必须经受控回调执行", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "tool", client: { async *stream() { yield { type: "tool_call", tool: "search", input: { q: "x" } }; yield { type: "done" }; } }, health: async () => "healthy" });
    registry.route("tutor", "tool");
    const request = { role: "tutor" as const, providerId: "tool", prompt: "safe", containsUserMaterials: false, confirmed: false };
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), request, new AbortController().signal)).rejects.toThrow("tool_dispatcher_required");
    const calls: unknown[] = [];
    const toolResults: unknown[] = [];
    const result = await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), { ...request, onToolCall: async (tool, input) => { calls.push({ tool, input }); return "safe-result"; }, onToolResult: (_tool, value) => toolResults.push(value) }, new AbortController().signal);
    expect(calls).toEqual([{ tool: "search", input: { q: "x" } }]);
    expect(result.toolResults).toEqual([{ tool: "search", result: "safe-result" }]);
    expect(toolResults).toEqual(["safe-result"]);
  });
  it("Provider 工具结果必须来自本地执行，不能凭模型事件冒充", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "tool-result", client: { async *stream() { yield { type: "tool_result" as const, tool: "search", result: { count: 1 } }; } }, health: async () => "healthy" });
    registry.route("tutor", "tool-result");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "tool-result", prompt: "safe", containsUserMaterials: false, confirmed: false,
    }, new AbortController().signal)).rejects.toThrow("untrusted_tool_result");
  });
  it("支持 Provider 在受控工具结果后继续下一模型回合", async () => {
    const registry = new ProviderRegistry();
    const continued: unknown[] = [];
    const client: ContinuableModelClient = {
      async *stream() { yield { type: "tool_call" as const, tool: "lookup", input: { id: "a" } }; },
      async *continue(_prompt, results) { continued.push(results); yield { type: "text_delta" as const, text: `答案：${(results[0]?.result as { value: string }).value}` }; yield { type: "done" as const }; },
    };
    registry.register({ id: "continuable", client, health: async () => "healthy" });
    registry.route("tutor", "continuable");
    const result = await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "continuable", prompt: "safe", containsUserMaterials: false, confirmed: false,
      onToolCall: async () => ({ value: "已查到" }),
    }, new AbortController().signal);
    expect(result.text).toBe("答案：已查到");
    expect(continued).toEqual([[{ tool: "lookup", result: { value: "已查到" } }]]);
    // The trace has no prompt or tool payload, but exposes loop shape.
    const traces: unknown[] = [];
    await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "continuable", prompt: "private", containsUserMaterials: false, confirmed: false,
      onToolCall: async () => ({ value: "已查到" }), onAudit: (record) => traces.push(record),
    }, new AbortController().signal);
    expect(traces).toEqual([expect.objectContaining({ turns: 2, toolCalls: 1 })]);
    expect(JSON.stringify(traces)).not.toContain("private");
  });
  it("未确认时拒绝把用户资料交给外部 Provider", async () => {
    await expect(collectInvocation(runtime(), {
      role: "tutor", providerId: "deepseek-api", prompt: "retrieved chunk", containsUserMaterials: true, confirmed: false,
    }, new AbortController().signal)).rejects.toThrow("external_content_confirmation_required");
  });

  it("已取消调用记录 cancelled 元数据", async () => {
    const controller = new AbortController();
    controller.abort();
    const audits: unknown[] = [];
    await expect(collectInvocation(runtime(), {
      role: "tutor", providerId: "mock", prompt: "cancelled prompt", containsUserMaterials: false, confirmed: false,
      onAudit: (record) => audits.push(record),
    }, controller.signal)).rejects.toThrow("cancelled");
    expect(audits).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(JSON.stringify(audits)).not.toContain("cancelled prompt");
  });

  it("模型失败只记录 error 元数据，不记录 prompt", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "broken", client: { async *stream() { yield { type: "text_delta", text: "" }; throw new Error("provider failed"); } }, health: async () => "unavailable" });
    registry.route("tutor", "broken");
    const audits: unknown[] = [];
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "broken", prompt: "private prompt", containsUserMaterials: false, confirmed: false,
      onAudit: (record) => audits.push(record),
    }, new AbortController().signal)).rejects.toThrow("provider failed");
    expect(audits).toEqual([expect.objectContaining({ status: "error", providerId: "broken" })]);
    expect(JSON.stringify(audits)).not.toContain("private prompt");
  });
  it("awaits asynchronous audit sinks before resolving the invocation", async () => {
    const order: string[] = [];
    const result = await collectInvocation(runtime(), {
      role: "tutor", providerId: "mock", prompt: "safe", containsUserMaterials: false, confirmed: false,
      onAudit: async () => { await new Promise((resolve) => setTimeout(resolve, 2)); order.push("audit"); },
    }, new AbortController().signal);
    order.push("returned");
    expect(result.text).toContain("Mock：");
    expect(order).toEqual(["audit", "returned"]);
  });

  it("无用户资料的 smoke prompt 可走角色 Runtime，并仅记录调用元数据", async () => {
    const audits: unknown[] = [];
    await expect(collectInvocation(runtime(), {
      role: "tutor", providerId: "mock", prompt: "health smoke", containsUserMaterials: false, confirmed: false,
      onAudit: (record) => audits.push(record),
    }, new AbortController().signal)).resolves.toMatchObject({ text: "Mock：health smoke", events: 2 });
    expect(audits).toEqual([expect.objectContaining({ providerId: "mock", role: "tutor", status: "success" })]);
    expect(JSON.stringify(audits)).not.toContain("health smoke");
  });

  it("审计记录实际执行的路由 Provider，并在受控降级后记录 mock", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "codex-cli", client: { async *stream() { throw new Error("live_provider_disabled: local mode"); yield { type: "done" as const }; } }, health: async () => "unavailable" });
    registry.route("tutor", "codex-cli");
    const audits: unknown[] = [];
    await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "routed", prompt: "health smoke", containsUserMaterials: false, confirmed: false,
      onAudit: (record) => audits.push(record),
    }, new AbortController().signal);
    expect(audits).toEqual([expect.objectContaining({ providerId: "mock", status: "success" })]);
  });

  it("E12：重复工具调用在模型 Runtime 边界被拒绝", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "tool", client: { async *stream() { yield { type: "tool_call", tool: "search", input: { q: "x" } }; yield { type: "tool_call", tool: "search", input: { q: "x" } }; } }, health: async () => "healthy" });
    registry.route("tutor", "tool");
    const dispatcher = new ToolDispatcher(new AgentLoop(), [{ name: "search", run: async () => "ok" }]);
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "tool", prompt: "safe", containsUserMaterials: false, confirmed: false,
      onToolCall: (tool, input) => dispatcher.call(tool, input),
    }, new AbortController().signal)).rejects.toThrow("repeated_tool_call");
  });

  it("即使回调未自带 dispatcher，重复工具调用也由 Invocation 边界拒绝", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "tool", client: { async *stream() { yield { type: "tool_call", tool: "search", input: { q: "x" } }; yield { type: "tool_call", tool: "search", input: { q: "x" } }; } }, health: async () => "healthy" });
    registry.route("tutor", "tool");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "tool", prompt: "safe", containsUserMaterials: false, confirmed: false, onToolCall: async () => "ok",
    }, new AbortController().signal)).rejects.toThrow("repeated_tool_call");
  });

  it("流式文本分段不会被误判为多个模型轮次", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "loop", client: { async *stream() { for (let index = 0; index < 7; index += 1) yield { type: "text_delta", text: String(index) }; } }, health: async () => "healthy" });
    registry.route("tutor", "loop");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "loop", prompt: "safe", containsUserMaterials: false, confirmed: false,
    }, new AbortController().signal)).resolves.toMatchObject({ text: "0123456", events: 7 });
  });
});
