import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
export async function buildWindowsSandbox(output) {
  if (process.platform !== "win32") return;
  const root = path.resolve(import.meta.dirname, "..");
  const compiler = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  await fs.mkdir(path.dirname(output), { recursive: true });
  const result = spawnSync(compiler, ["/nologo", "/target:exe", "/platform:x64", "/optimize+", "/reference:System.Web.Extensions.dll", `/out:${output}`, path.join(root, "scripts/windows-sandbox.cs")], { stdio: "inherit", shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error("windows_sandbox_build_failed");
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await buildWindowsSandbox(path.resolve(import.meta.dirname, "../.build/windows-sandbox.exe"));
