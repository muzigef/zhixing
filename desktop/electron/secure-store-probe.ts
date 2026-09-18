import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { platformCipher } from "../core/platform-cipher.js";
import { EncryptedDesktopSecrets } from "../core/secrets.js";
/** Explicit native acceptance only; never opens product data, legacy Keychain items, or a provider. */
export async function prepareSecureStoreProbe(): Promise<() => Promise<number>> {
  const stage = process.env.ZHIXING_SECURE_STORE_PROBE;
  if (!["create", "restart", "deny"].includes(stage ?? "")) throw new Error("secure_probe_stage_invalid");
  const selected = process.env.ZHIXING_DESKTOP_TEST_DATA;
  if (!selected) throw new Error("secure_probe_isolation_required");
  const root = await fs.realpath(selected), temporary = await fs.realpath(os.tmpdir());
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith("zhixing-native-secret-")) throw new Error("secure_probe_isolation_required");
  app.setName("知行"); app.setPath("userData", root);
  return () => runSecureStoreProbe(root, stage!);
}
async function runSecureStoreProbe(root: string, stage: string): Promise<number> {
  const cipher = platformCipher(process.platform, safeStorage), capability = await cipher.describe();
  const provenance = JSON.parse(await fs.readFile(path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "build"), "runtime/build-provenance.json"), "utf8")) as { codeHash: string };
  if (!/^[a-f0-9]{64}$/.test(provenance.codeHash)) throw new Error("secure_probe_provenance_invalid");
  const receipt = { version: 1, codeHash: provenance.codeHash, stage, at: new Date().toISOString(), platform: process.platform, arch: process.arch, osRelease: os.release(), electron: process.versions.electron, packaged: app.isPackaged, executableSha256: createHash("sha256").update(await fs.readFile(process.execPath)).digest("hex"), capability, passed: false, checks: [] as string[], reason: "" };
  try {
    if (stage === "deny") {
      if (process.platform !== "linux" || capability.backend !== "basic_text" || capability.available) throw new Error("secure_probe_expected_denial");
      try { await cipher.encrypt("zhixing-synthetic-native-probe-only"); throw new Error("secure_probe_unprotected_write"); } catch (error) { if (!(error instanceof Error) || error.message !== "secret_store_unavailable") throw error; }
      receipt.checks.push("basic_text_rejected_before_write");
    } else {
      if (!capability.available) throw new Error("secure_probe_backend_unavailable");
      const reference = "keychain:zhixing/deepseek-api", synthetic = "zhixing-synthetic-native-probe-only";
      const store = new EncryptedDesktopSecrets(root, cipher);
      if (stage === "create") await store.set(reference, synthetic);
      if (await store.get(reference) !== synthetic) throw new Error("secure_probe_roundtrip_failed");
      const file = path.join(root, "deepseek.credential"), encrypted = await fs.readFile(file);
      if (encrypted.includes(Buffer.from(synthetic))) throw new Error("secure_probe_plaintext_file");
      if (process.platform !== "win32" && ((await fs.stat(file)).mode & 0o777) !== 0o600) throw new Error("secure_probe_file_mode");
      receipt.checks.push(stage === "restart" ? "new_process_decryption" : "encrypted_roundtrip", "no_plaintext_in_ciphertext");
      if (stage === "restart") {
        await fs.writeFile(file, Buffer.from("synthetic-invalid-ciphertext"));
        try { await store.get(reference); throw new Error("secure_probe_malformed_accepted"); } catch (error) { if (!(error instanceof Error) || error.message !== "secret_store_unavailable") throw error; } finally { await fs.writeFile(file, encrypted); }
        receipt.checks.push("malformed_ciphertext_rejected");
      }
    }
    receipt.passed = true;
  } catch (error) { receipt.reason = error instanceof Error && /^secure_probe_[a-z_]+$/.test(error.message) ? error.message : "secure_probe_failed"; }
  await fs.writeFile(path.join(root, `native-${stage}.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return receipt.passed ? 0 : 1;
}
