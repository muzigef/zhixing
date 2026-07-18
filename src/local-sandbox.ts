import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SandboxResult = { status: "completed" | "timed_out" | "unavailable"; stdout: string; stderr: string; exitCode: number | null };

/** macOS sandbox-exec wrapper. No shell, no inherited working directory, no network rule. */
export class LocalSandbox {
  constructor(private readonly executable = "sandbox-exec") {}
  async run(command: string, args: readonly string[], options: { timeoutMs?: number; allowedCommands?: readonly string[] } = {}): Promise<SandboxResult> {
    if (!(options.allowedCommands ?? []).includes(command)) throw new Error("sandbox_command_denied");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-sandbox-"));
    if (!path.isAbsolute(command)) throw new Error("sandbox_command_denied");
    const profile = `(version 1) (deny default) (allow process-exec (literal "${quote(command)}")) (allow file-read* (literal "${quote(command)}") (subpath "/System") (subpath "/usr/lib") (subpath "${quote(directory)}")) (allow file-write* (subpath "${quote(directory)}")) (deny network*)`;
    try {
      return await new Promise((resolve) => {
        let stdout = ""; let stderr = ""; let timedOut = false;
        const child = spawn(this.executable, ["-p", profile, command, ...args], { cwd: directory, shell: false, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (data: Buffer) => { stdout = `${stdout}${data}`.slice(0, 64 * 1024); });
        child.stderr.on("data", (data: Buffer) => { stderr = `${stderr}${data}`.slice(0, 64 * 1024); });
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs ?? 5_000);
        child.on("error", () => { clearTimeout(timer); resolve({ status: "unavailable", stdout, stderr, exitCode: null }); });
        child.on("close", (exitCode) => { clearTimeout(timer); resolve({ status: timedOut ? "timed_out" : "completed", stdout, stderr, exitCode }); });
      });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}

function quote(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
