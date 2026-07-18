import { spawn } from "node:child_process";
import type { SecretStore } from "./secret-store.js";

export type KeychainRunner = (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** macOS Keychain adapter; callers keep only secretRef, never the secret value in config. */
export class MacOSKeychainSecretStore implements SecretStore {
  constructor(private readonly runner: KeychainRunner = runSecurity, private readonly platform = process.platform) {}

  async set(reference: string, value: string): Promise<void> {
    this.assertAvailable();
    this.assertReference(reference);
    const result = await this.runner(["add-generic-password", "-U", "-a", "zhixing", "-s", reference, "-w", value]);
    if (result.code !== 0) throw new Error("secret_store_unavailable");
  }

  async get(reference: string): Promise<string | undefined> {
    this.assertAvailable();
    this.assertReference(reference);
    const result = await this.runner(["find-generic-password", "-a", "zhixing", "-s", reference, "-w"]);
    if (result.code === 44) return undefined;
    if (result.code !== 0) throw new Error("secret_store_unavailable");
    return result.stdout.trim() || undefined;
  }

  async delete(reference: string): Promise<boolean> {
    this.assertAvailable();
    this.assertReference(reference);
    const result = await this.runner(["delete-generic-password", "-a", "zhixing", "-s", reference]);
    if (result.code === 44) return false;
    if (result.code !== 0) throw new Error("secret_store_unavailable");
    return true;
  }

  private assertAvailable(): void { if (this.platform !== "darwin") throw new Error("secret_store_unavailable"); }
  private assertReference(reference: string): void { if (!/^keychain:zhixing\/[a-z][a-z0-9-]*$/.test(reference)) throw new Error("invalid_secret_reference"); }
}

async function runSecurity(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk}`.slice(0, 64 * 1024); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk}`.slice(0, 16 * 1024); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
