import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockModelClient } from "../src/model.js";
import { ModelRoutingStore } from "../src/model-routing-store.js";
import { ProviderRegistry } from "../src/provider-registry.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("model routing store", () => {
  it("只保存角色路由并在已注册 Provider 中恢复", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-routing-"));
    roots.push(root);
    const file = path.join(root, "model-routing.local.json");
    const provider = { id: "mock", client: new MockModelClient(), health: async () => "healthy" as const };
    const source = new ProviderRegistry();
    source.register(provider);
    source.route("tutor", "mock");
    const store = new ModelRoutingStore(file);
    await store.save(source);
    expect(await fs.readFile(file, "utf8")).not.toContain("secret");
    const restored = new ProviderRegistry();
    restored.register(provider);
    await store.load(restored);
    expect(restored.routedProvider("tutor")).toBe("mock");
  });
});
