import { expect, it, vi } from "vitest";
import { platformCipher } from "../desktop/core/platform-cipher.js";
function fixture() {
  return { isAsyncEncryptionAvailable: vi.fn(async () => true), isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"), encryptStringAsync: vi.fn(async (s: string) => Buffer.from(`async:${s}`)), decryptStringAsync: vi.fn(async () => ({ result: "synthetic", shouldReEncrypt: false })), encryptString: vi.fn((s: string) => Buffer.from(`sync:${s}`)), decryptString: vi.fn(() => "synthetic") };
}
it("rejects Linux basic_text, unknown or missing stores even when Electron says encryption is available", async () => {
  for (const backend of ["basic_text", "unknown", "future_backend"]) {
    const api = fixture(); api.getSelectedStorageBackend.mockReturnValue(backend); const cipher = platformCipher("linux", api);
    expect(await cipher.available()).toBe(false);
    await expect(cipher.encrypt("synthetic")).rejects.toThrow("secret_store_unavailable");
    await expect(cipher.decrypt(Buffer.from("synthetic"))).rejects.toThrow("secret_store_unavailable");
    expect(api.encryptString).not.toHaveBeenCalled(); expect(api.encryptStringAsync).not.toHaveBeenCalled();
  }
});
it("uses the backend-observable synchronous API on Linux and rechecks a changed backend before encryption", async () => {
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    const api = fixture(); api.getSelectedStorageBackend.mockReturnValue(backend); const cipher = platformCipher("linux", api);
    expect(await cipher.describe()).toMatchObject({ platform: "linux", backend, api: "sync", available: true });
    expect((await cipher.encrypt("synthetic")).toString()).toBe("sync:synthetic");
    expect(await cipher.decrypt(Buffer.from("fixture"))).toBe("synthetic");
    expect(api.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
    api.getSelectedStorageBackend.mockReturnValue("basic_text");
    await expect(cipher.encrypt("changed")).rejects.toThrow("secret_store_unavailable");
    expect(api.encryptString).toHaveBeenCalledTimes(1);
  }
});
it("keeps macOS and Windows on async OS providers and fails closed on unsupported platforms/errors", async () => {
  for (const platform of ["darwin", "win32"]) {
    const api = fixture(), cipher = platformCipher(platform, api);
    expect(await cipher.available()).toBe(true); expect((await cipher.encrypt("synthetic")).toString()).toBe("async:synthetic");
    expect(api.getSelectedStorageBackend).not.toHaveBeenCalled();
    api.isAsyncEncryptionAvailable.mockRejectedValue(new Error("private OS error"));
    expect(await cipher.available()).toBe(false);
    await expect(cipher.decrypt(Buffer.from("bad"))).rejects.toThrow(/^secret_store_unavailable$/);
  }
  expect(await platformCipher("freebsd", fixture()).available()).toBe(false);
});
