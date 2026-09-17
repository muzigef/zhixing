import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
export async function buildPosixSandbox(output) {
  if (!["darwin", "linux"].includes(process.platform)) return;
  await fs.mkdir(path.dirname(output), { recursive: true });
  const source = path.resolve(import.meta.dirname, "sandbox-supervisor.c");
  const result = spawnSync(process.platform === "darwin" ? "/usr/bin/clang" : "/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", source, "-o", output, ...(process.platform === "darwin" ? ["-lproc"] : [])], { stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error("posix_sandbox_build_failed");
  await fs.chmod(output, 0o755);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await buildPosixSandbox(path.resolve(import.meta.dirname, "../.build/sandbox-supervisor"));
