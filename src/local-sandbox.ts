import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SandboxResult = { status: "completed" | "timed_out" | "unavailable" | "cancelled"; stdout: string; stderr: string; exitCode: number | null };

/** macOS sandbox-exec wrapper. No shell, no inherited working directory, no network rule. */
export class LocalSandbox {
  constructor(private readonly executable = "sandbox-exec") {}
  async run(command: string, args: readonly string[], options: { timeoutMs?: number; allowedCommands?: readonly string[]; files?: Readonly<Record<string, string>>; signal?: AbortSignal; runtimeReadPath?: string; electronNode?: boolean } = {}): Promise<SandboxResult> {
    if (!(options.allowedCommands ?? []).includes(command)) throw new Error("sandbox_command_denied");
    if (!path.isAbsolute(command)) throw new Error("sandbox_command_denied");
    options.signal?.throwIfAborted();
    if (process.platform !== "darwin") return { status: "unavailable", stdout: "", stderr: "本平台尚无已验证的代码沙箱。", exitCode: null };
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-sandbox-")));
    const profile = `(version 1) (deny default) (allow process-exec (literal "${quote(command)}")) (allow sysctl-read) (allow file-read-metadata) (allow mach-lookup (global-name "com.apple.cfprefsd.agent")) (allow file-read* (literal "/") (literal "${quote(command)}") (subpath "/System") (subpath "/usr/lib") (literal "/dev/null") ${options.runtimeReadPath ? `(subpath "${quote(options.runtimeReadPath)}")` : ""} (subpath "${quote(directory)}")) (allow file-write* (subpath "${quote(directory)}")) (deny network*)`;
    try {
      for (const [name, content] of Object.entries(options.files ?? {})) { if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") throw new Error("sandbox_file_denied"); await fs.writeFile(path.join(directory, name), content, { flag: "wx", mode: 0o600 }); }
      options.signal?.throwIfAborted();
      return await new Promise((resolve) => {
        let stdout = ""; let stderr = ""; let timedOut = false; let cancelled = false;
        const child = spawn(this.executable, ["-p", profile, command, ...args], { cwd: directory, shell: false, env: { PATH: "/usr/bin:/bin", ...(options.electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
        const abort = () => { cancelled = true; child.kill("SIGKILL"); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        child.stdout.on("data", (data: Buffer) => { stdout = `${stdout}${data}`.slice(0, 64 * 1024); });
        child.stderr.on("data", (data: Buffer) => { stderr = `${stderr}${data}`.slice(0, 64 * 1024); });
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs ?? 5_000);
        child.on("error", () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve({ status: "unavailable", stdout, stderr, exitCode: null }); });
        child.on("close", (exitCode) => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve({ status: cancelled ? "cancelled" : timedOut ? "timed_out" : "completed", stdout, stderr, exitCode }); });
      });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}

function quote(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
