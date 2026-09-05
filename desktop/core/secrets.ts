import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SecretStore } from "../../src/secret-store.js";
export interface DesktopCipher {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
export interface LegacySecret {
  has(): Promise<boolean>;
  get(): Promise<string | undefined>;
}
export interface SecretStatus {
  configured: boolean;
  source?: "desktop" | "system-keychain";
}
/** Secrets are only handled by the main process; renderer status never includes their value. */
export class EncryptedDesktopSecrets implements SecretStore {
  private readonly file: string;
  constructor(
    root: string,
    private readonly cipher: DesktopCipher,
    private readonly legacy?: LegacySecret,
  ) {
    this.file = path.join(root, "deepseek.credential");
  }
  async status(): Promise<SecretStatus> {
    if (await this.exists()) return { configured: true, source: "desktop" };
    if (await this.legacy?.has())
      return { configured: true, source: "system-keychain" };
    return { configured: false };
  }
  async get(reference: string): Promise<string | undefined> {
    this.assertReference(reference);
    if (!(await this.exists())) return this.legacy?.get();
    if (!(await this.cipher.available()))
      throw new Error("secret_store_unavailable");
    const handle = await fs.open(
      this.file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if ((await handle.stat()).size > 32_000)
        throw new Error("secret_store_unavailable");
      return await this.cipher.decrypt(await handle.readFile());
    } catch {
      throw new Error("secret_store_unavailable");
    } finally {
      await handle.close();
    }
  }
  async set(reference: string, value: string): Promise<void> {
    this.assertReference(reference);
    const key = value.trim();
    if (key.length < 8 || key.length > 4096 || /\s/.test(key))
      throw new Error("invalid_api_key");
    if (!(await this.cipher.available()))
      throw new Error("secret_store_unavailable");
    const encrypted = await this.cipher.encrypt(key);
    await this.exists();
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async delete(reference: string): Promise<boolean> {
    this.assertReference(reference);
    throw new Error("secret_deletion_requires_confirmation");
  }
  private assertReference(reference: string): void {
    if (reference !== "keychain:zhixing/deepseek-api")
      throw new Error("invalid_secret_reference");
  }
  private async exists(): Promise<boolean> {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32_000)
        throw new Error("secret_store_unavailable");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
