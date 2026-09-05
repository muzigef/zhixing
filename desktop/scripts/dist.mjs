import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Desktop distribution currently targets macOS and Windows");
for (const script of ["prepare-runtime.mjs", "build.mjs"]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, [path.join(root, "node_modules/electron-builder/cli.js"), process.platform === "darwin" ? "--mac" : "--win", ...(process.platform === "darwin" ? ["dmg", "zip"] : ["nsis"]), `--${process.arch}`, "--publish", "never"], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
