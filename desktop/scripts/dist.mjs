import { spawnSync } from "node:child_process";
import path from "node:path";
import { getSigningPlan } from "./macos-signing.mjs";
import { packagingConfiguration } from "./packaging-config.mjs";
const root = path.resolve(import.meta.dirname, "..");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Desktop distribution currently targets macOS and Windows");
const args = process.argv.slice(2);
if (args.some(arg => !["--dir", "--platform=darwin", "--platform=win32", "--arch=arm64", "--arch=x64"].includes(arg))) throw new Error("invalid_packaging_argument");
const targetPlatform = args.find(arg => arg.startsWith("--platform="))?.slice(11) ?? process.platform;
if (targetPlatform !== process.platform) throw new Error("Build on the target operating system to verify native modules and signing.");
const targetArch = args.find(arg => arg.startsWith("--arch="))?.slice(7) ?? process.arch;
// Preflight before touching the previous bundle, rebuilding or opening Keychain.
const plan = getSigningPlan();
const { environment, config } = packagingConfiguration(plan, process.env);
for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
Object.assign(process.env, environment);
for (const script of ["prepare-runtime.mjs", "build.mjs"]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const { build, Platform, archFromString } = await import("electron-builder");
const platform = process.platform === "darwin" ? Platform.MAC : Platform.WINDOWS;
await build({
  projectDir: root, publish: "never", config,
  targets: platform.createTarget(args.includes("--dir") ? ["dir"] : process.platform === "darwin" ? ["dmg", "zip"] : ["nsis"], archFromString(targetArch)),
});
