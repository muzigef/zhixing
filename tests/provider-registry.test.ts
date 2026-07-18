import { describe, expect, it } from "vitest";
import { MockModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { MemorySecretStore } from "../src/secret-store.js";

describe("provider registry and secret boundary", () => {
  it("按角色路由已注册 Provider，并标准化健康失败", async () => {
    const registry = new ProviderRegistry();
    const client = new MockModelClient();
    registry.register({ id: "mock", client, health: async () => "healthy" });
    registry.register({ id: "broken", client, health: async () => { throw new Error("offline"); } });
    registry.route("tutor", "mock");
    expect(registry.resolve("tutor")).toBe(client);
    await expect(registry.health("mock", new AbortController().signal)).resolves.toBe("healthy");
    await expect(registry.health("broken", new AbortController().signal)).resolves.toBe("unavailable");
  });

  it("SecretStore 只通过引用访问，不写入 Runtime 配置", async () => {
    const store = new MemorySecretStore();
    await store.set("keychain:zhixing/mock", "test-secret");
    await expect(store.get("keychain:zhixing/mock")).resolves.toBe("test-secret");
    await expect(store.delete("keychain:zhixing/mock")).resolves.toBe(true);
    await expect(store.get("keychain:zhixing/mock")).resolves.toBeUndefined();
  });
});
