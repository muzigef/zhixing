import { describe, expect, it } from "vitest";
import { collectInvocation } from "../src/model-invocation.js";
import { MockModelClient } from "../src/model.js";
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
  it("模型 tool_call 必须经受控回调执行", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "tool", client: { async *stream() { yield { type: "tool_call", tool: "search", input: { q: "x" } }; yield { type: "done" }; } }, health: async () => "healthy" });
    registry.route("tutor", "tool");
    const request = { role: "tutor" as const, providerId: "tool", prompt: "safe", containsUserMaterials: false, confirmed: false };
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), request, new AbortController().signal)).rejects.toThrow("tool_dispatcher_required");
    const calls: unknown[] = [];
    await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), { ...request, onToolCall: async (tool, input) => { calls.push({ tool, input }); } }, new AbortController().signal);
    expect(calls).toEqual([{ tool: "search", input: { q: "x" } }]);
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

  it("E12：超过最大模型轮次会稳定停止", async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: "loop", client: { async *stream() { for (let index = 0; index < 7; index += 1) yield { type: "text_delta", text: String(index) }; } }, health: async () => "healthy" });
    registry.route("tutor", "loop");
    await expect(collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "loop", prompt: "safe", containsUserMaterials: false, confirmed: false,
    }, new AbortController().signal)).rejects.toThrow("max_turns");
  });
});
