import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySecretStore } from "../src/secret-store.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { EncryptedDesktopSecrets } from "../desktop/core/secrets.js";
import { settingsSchema } from "../desktop/core/contracts.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-provider-"));
  roots.push(value);
  return value;
}
const reference = "keychain:zhixing/deepseek-api";
const cipher = {
  available: async () => true,
  encrypt: async (text: string) => Buffer.from([...text].reverse().join("")),
  decrypt: async (buffer: Buffer) => [...buffer.toString()].reverse().join(""),
};
describe("desktop API / Pi switching", () => {
  it("switches a failed Pi conversation to the real API adapter while retaining context and selected-provider history", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(reference, "fixture-desktop-key");
    const requests: string[] = [];
    const deepseek = new DeepSeekClient(
      secrets,
      async (_url, request) => {
        requests.push(String(request.body));
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: "API 回答" }, finish_reason: "stop" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
      { ZHIXING_ALLOW_LIVE_PROVIDER: "1" },
    );
    const service = new DesktopService(
      new DesktopStore(await root()),
      (provider) =>
        provider === "deepseek-api"
          ? deepseek
          : {
              async *stream() {
                yield { type: "text_delta", text: "" };
                throw new Error("pi_login_required");
              },
            },
    );
    const session = await service.create();
    await service.send({
      sessionId: session.id,
      text: "帮我理解学习率",
      provider: "pi-codex",
      style: "adaptive",
    });
    await service.idle();
    await service.send({
      sessionId: session.id,
      text: "请用 DeepSeek 继续解释",
      provider: "deepseek-api",
      style: "adaptive",
    });
    await service.idle();
    const saved = await service.load(session.id);
    expect(saved.messages[1]).toMatchObject({
      status: "failed",
      provider: "pi-codex",
    });
    expect(saved.messages.at(-1)).toMatchObject({
      status: "completed",
      provider: "deepseek-api",
      text: "API 回答",
    });
    expect(requests[0]).toContain("帮我理解学习率");
    const settings = settingsSchema.parse({
      provider: "deepseek-api",
      deepseekModel: "deepseek-v4-pro",
    });
    await service.store.saveSettings(settings);
    expect(await service.store.settings()).toEqual(settings);
  });
  it("checks legacy configuration without reading its key, and reuses it only for an API request", async () => {
    const legacy = {
      has: vi.fn(async () => true),
      get: vi.fn(async () => "fixture-legacy-key"),
    };
    const secrets = new EncryptedDesktopSecrets(await root(), cipher, legacy);
    expect(await secrets.status()).toEqual({
      configured: true,
      source: "system-keychain",
    });
    expect(legacy.get).not.toHaveBeenCalled();
    expect(await secrets.get(reference)).toBe("fixture-legacy-key");
  });
  it("encrypts GUI configuration and never writes the supplied key in plaintext", async () => {
    const directory = await root();
    const secrets = new EncryptedDesktopSecrets(directory, cipher);
    await secrets.set(reference, "fixture-private-key");
    const bytes = await fs.readFile(
      path.join(directory, "deepseek.credential"),
    );
    expect(bytes.toString()).not.toContain("fixture-private-key");
    expect(await secrets.get(reference)).toBe("fixture-private-key");
    expect(await secrets.status()).toEqual({
      configured: true,
      source: "desktop",
    });
  });
  it("fails closed without OS encryption and rejects unrelated references", async () => {
    const secrets = new EncryptedDesktopSecrets(await root(), {
      ...cipher,
      available: async () => false,
    });
    await expect(secrets.set(reference, "fixture-private-key")).rejects.toThrow(
      "secret_store_unavailable",
    );
    await expect(secrets.get("keychain:another-provider")).rejects.toThrow(
      "invalid_secret_reference",
    );
  });
});
