import { describe, expect, it } from "vitest";
import { MockModelClient, type ModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

async function collect(runtime: ProviderRuntime): Promise<string[]> {
  const values: string[] = [];
  for await (const event of runtime.stream("tutor", "lesson", new AbortController().signal)) values.push(event.text ?? event.type);
  return values;
}

describe("provider runtime", () => {
  it("角色路由优先，缺少路由时回退 mock", async () => {
    const registry = new ProviderRegistry();
    const routed = new MockModelClient();
    registry.register({ id: "mock", client: routed, health: async () => "healthy" });
    registry.route("tutor", "mock");
    const runtime = new ProviderRuntime(registry, new MockModelClient());
    await expect(collect(runtime)).resolves.toEqual(["Mock：lesson", "done"]);
    await expect(runtime.status("mock", new AbortController().signal)).resolves.toBe("healthy");
  });

  it("路由 Provider 失败时降级到 fallback", async () => {
    const failing: ModelClient = { async *stream() { throw new Error("provider_unavailable"); yield { type: "done" as const }; } };
    const registry = new ProviderRegistry();
    registry.register({ id: "failed", client: failing, health: async () => "unavailable" });
    registry.route("tutor", "failed");
    await expect(collect(new ProviderRuntime(registry, new MockModelClient()))).resolves.toEqual(["Mock：lesson", "done"]);
  });

  it("纯本地模式禁用的 Provider 同样降级到 mock", async () => {
    const disabled: ModelClient = { async *stream() { throw new Error("live_provider_disabled: local mode"); yield { type: "done" as const }; } };
    const registry = new ProviderRegistry();
    registry.register({ id: "codex-cli", client: disabled, health: async () => "unavailable" });
    registry.route("tutor", "codex-cli");
    await expect(collect(new ProviderRuntime(registry, new MockModelClient()))).resolves.toEqual(["Mock：lesson", "done"]);
  });
});
