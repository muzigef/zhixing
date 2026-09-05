import { safeStorage } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MacOSKeychainSecretStore } from "../../src/macos-keychain.js";
import { EncryptedDesktopSecrets, type LegacySecret } from "../core/secrets.js";

export function desktopSecrets(root: string): EncryptedDesktopSecrets {
  // Tests are isolated from the user's real Keychain unless a live check is explicitly requested.
  const useLegacy =
    process.platform === "darwin" &&
    (!process.env.ZHIXING_DESKTOP_TEST_DATA ||
      process.env.ZHIXING_DESKTOP_LIVE_CHECK === "1");
  const keychain = new MacOSKeychainSecretStore(async (args) => {
    try {
      const result = await promisify(execFile)("/usr/bin/security", [...args], {
        timeout: 15_000,
        maxBuffer: 64_000,
      });
      return { code: 0, stdout: result.stdout, stderr: "" };
    } catch (error) {
      return {
        code: (error as { code?: number }).code === 44 ? 44 : 1,
        stdout: "",
        stderr: "",
      };
    }
  });
  const legacy: LegacySecret | undefined = useLegacy
    ? {
        has: () =>
          new Promise((resolve) => {
            // No -w/-g: check metadata only and discard command output.
            const child = execFile(
              "/usr/bin/security",
              [
                "find-generic-password",
                "-a",
                "zhixing",
                "-s",
                "keychain:zhixing/deepseek-api",
              ],
              { timeout: 4000, maxBuffer: 16_000 },
              (error) => resolve(!error),
            );
            child.stdout?.resume();
            child.stderr?.resume();
          }),
        get: () => keychain.get("keychain:zhixing/deepseek-api"),
      }
    : undefined;
  return new EncryptedDesktopSecrets(
    root,
    {
      available: async () =>
        process.platform !== "linux" &&
        (await safeStorage.isAsyncEncryptionAvailable()),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: async (value) =>
        (await safeStorage.decryptStringAsync(value)).result,
    },
    legacy,
  );
}
