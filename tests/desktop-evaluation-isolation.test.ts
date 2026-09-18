import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EncryptedDesktopSecrets } from "../desktop/core/secrets.js";
import { evaluationCommandAllowed } from "../desktop/core/evaluation-isolation.js";
it("uses existing encrypted test credentials read-only and rejects writes before encryption", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evaluation-secrets-")); let encryptions = 0;
  const cipher = { available: async () => true, encrypt: async (text: string) => { encryptions++; return Buffer.from(text); }, decrypt: async (value: Buffer) => value.toString() };
  try {
    await new EncryptedDesktopSecrets(root, cipher).set("keychain:zhixing/deepseek-api", "synthetic-fixture-only");
    const store = new EncryptedDesktopSecrets(root, cipher, undefined, "deepseek-api", true);
    expect(await store.status()).toEqual({ configured: true, source: "desktop" });
    expect(await store.get("keychain:zhixing/deepseek-api")).toBe("synthetic-fixture-only");
    await expect(store.set("keychain:zhixing/deepseek-api", "changed-fixture-only")).rejects.toThrow("evaluation_read_only");
    expect(encryptions).toBe(1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("limits isolated live evaluation to fixed suites and safe status/session reads", () => {
  for (const type of ["team-evaluate", "team-evaluation-status", "native-agent-status", "boot", "check-api", "new", "load"]) expect(evaluationCommandAllowed(type)).toBe(true);
  for (const type of ["send", "enqueue", "configure-kimi", "api-connection-save", "workspace-select", "workspace-restore", "settings", "project-test", "unknown"]) expect(evaluationCommandAllowed(type)).toBe(false);
});
