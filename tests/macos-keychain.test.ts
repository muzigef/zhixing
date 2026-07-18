import { describe, expect, it } from "vitest";
import { MacOSKeychainSecretStore } from "../src/macos-keychain.js";

describe("macOS Keychain secret store", () => {
  it("使用固定 security argv，不把 secretRef 解释为 shell", async () => {
    const calls: readonly string[][] = [];
    const runner = async (args: readonly string[]) => {
      (calls as string[][]).push([...args]);
      return { code: 0, stdout: "secret\n", stderr: "" };
    };
    const store = new MacOSKeychainSecretStore(runner, "darwin");
    await store.set("keychain:zhixing/openai-api", "value");
    await expect(store.get("keychain:zhixing/openai-api")).resolves.toBe("secret");
    await expect(store.delete("keychain:zhixing/openai-api")).resolves.toBe(true);
    expect(calls[0]).toEqual(["add-generic-password", "-U", "-a", "zhixing", "-s", "keychain:zhixing/openai-api", "-w", "value"]);
  });

  it("拒绝非 macOS 和非法引用，不创建明文降级", async () => {
    const store = new MacOSKeychainSecretStore(async () => ({ code: 0, stdout: "", stderr: "" }), "linux");
    await expect(store.get("keychain:zhixing/openai-api")).rejects.toThrow("secret_store_unavailable");
    const mac = new MacOSKeychainSecretStore(async () => ({ code: 0, stdout: "", stderr: "" }), "darwin");
    await expect(mac.get("../../auth")).rejects.toThrow("invalid_secret_reference");
  });
});
