import { describe, expect, it } from "vitest";
import { ProviderSetup } from "../src/provider-setup.js";
import { MemorySecretStore } from "../src/secret-store.js";

describe("provider setup", () => {
  it("只返回 secretRef，密钥仅进入 SecretStore", async () => {
    const secrets = new MemorySecretStore();
    const setup = new ProviderSetup(secrets);
    await expect(setup.configureApiKey("openai-api", "fixture-key-123456")).resolves.toEqual({ secretRef: "keychain:zhixing/openai-api" });
    await expect(secrets.get("keychain:zhixing/openai-api")).resolves.toBe("fixture-key-123456");
  });

  it("拒绝短密钥和危险 provider ID", async () => {
    const setup = new ProviderSetup(new MemorySecretStore());
    await expect(setup.configureApiKey("../bad", "fixture-key-123456")).rejects.toThrow("invalid_provider_id");
    await expect(setup.configureApiKey("openai-api", "short")).rejects.toThrow("invalid_api_key");
  });
});
