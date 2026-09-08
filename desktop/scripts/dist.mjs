import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Desktop distribution currently targets macOS and Windows");
const signing = process.platform === "darwin" && process.env.ZHIXING_SIGN_MACOS === "1";
// An empty CSC_LINK is treated as the project directory by electron-builder.
// Unsigned runs must omit signing inputs entirely, including empty CI secrets.
if (!signing) for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) delete process.env[key];
if (signing) {
  for (const key of ["CSC_LINK", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) if (!process.env[key]) throw new Error(`Signing configuration missing: ${key}`);
}
for (const script of ["prepare-runtime.mjs", "build.mjs"]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, [path.join(root, "node_modules/electron-builder/cli.js"), process.platform === "darwin" ? "--mac" : "--win", ...(process.platform === "darwin" ? ["dmg", "zip"] : ["nsis"]), `--${process.arch}`, "--publish", "never", ...(signing ? ["--config.forceCodeSigning=true", "--config.mac.hardenedRuntime=true", "--config.mac.notarize=true"] : [])], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
