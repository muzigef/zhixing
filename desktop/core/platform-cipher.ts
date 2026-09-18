import type { DesktopCipher } from "./secrets.js";
interface StorageAPI {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export interface CipherCapability { platform: string; backend: string; api: "async" | "sync" | "unavailable"; available: boolean; }
/** Linux backend identity describes the synchronous provider only. Never infer async protection from it. */
export function platformCipher(platform: string, storage: StorageAPI): DesktopCipher & { describe(): Promise<CipherCapability> } {
  async function describe(): Promise<CipherCapability> {
    try {
      if (platform === "linux") {
        const ready = storage.isEncryptionAvailable(), selected = storage.getSelectedStorageBackend();
        const trusted = ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(selected);
        return { platform, backend: trusted || selected === "basic_text" ? selected : "unknown", api: "sync", available: ready && trusted };
      }
      if (platform === "darwin" || platform === "win32") return { platform, backend: platform === "darwin" ? "keychain" : "dpapi", api: "async", available: await storage.isAsyncEncryptionAvailable() };
    } catch { /* Backend errors must not disclose OS or credential details. */ }
    return { platform, backend: "unknown", api: "unavailable", available: false };
  }
  async function requireAvailable() { const result = await describe(); if (!result.available) throw new Error("secret_store_unavailable"); return result; }
  return { describe, available: async () => (await describe()).available,
    encrypt: async value => {
      const capability = await requireAvailable();
      try { return capability.api === "sync" ? storage.encryptString(value) : await storage.encryptStringAsync(value); } catch { throw new Error("secret_store_unavailable"); }
    },
    decrypt: async value => {
      const capability = await requireAvailable();
      try { return capability.api === "sync" ? storage.decryptString(value) : (await storage.decryptStringAsync(value)).result; } catch { throw new Error("secret_store_unavailable"); }
    },
  };
}
