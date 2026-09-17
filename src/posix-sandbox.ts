import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { z } from "zod/v4";
import { sandboxProfile } from "./sandbox-profile.js";
import { sandboxPolicyId } from "./sandbox-policy.js";
import type { SandboxBackend, SandboxRequest, SandboxResult, SandboxSession } from "./sandbox-types.js";

export function posixSandboxHelper(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [resources ? path.join(resources, "runtime/sandbox-supervisor") : "", path.join(here, "runtime/sandbox-supervisor"), path.join(here, "../.build/sandbox-supervisor")].find(file => file && existsSync(file));
}
export function bubblewrapExecutable(): string | undefined { return ["/usr/bin/bwrap", "/bin/bwrap"].find(file => existsSync(file)); }
const completionSchema = z.object({ status: z.enum(["completed", "timed_out", "unavailable", "cancelled", "resource_limited"]), exitCode: z.number().int().nullable(), limit: z.enum(["memory", "cpu", "workspace"]).optional() }).strict();
async function readGrants(request: SandboxRequest): Promise<{ path: string; directory: boolean }[]> {
  return Promise.all([...(request.options.runtimeReadPath ? [request.options.runtimeReadPath] : []), ...(request.options.readPaths ?? [])].map(async value => {
    const resolved = await fs.realpath(value);
    if (resolved === path.parse(resolved).root || (os.homedir() === resolved || os.homedir().startsWith(resolved + path.sep)) || /(?:^|[\\/])(?:\.ssh|\.codex|\.env(?:\.[^\\/]*)?|auth\.json)(?:[\\/]|$)/i.test(resolved)) throw new Error("sandbox_read_denied");
    const stat = await fs.stat(resolved); if (!stat.isDirectory() && !stat.isFile()) throw new Error("sandbox_read_denied");
    return { path: resolved, directory: stat.isDirectory() };
  }));
}

/** Common supervised lifecycle; OS adapters only construct the isolation launch. */
export class PosixSandboxBackend implements SandboxBackend {
  readonly capabilities = { memory: "monitored" as const, interactive: true };
  readonly id: string;
  constructor(private readonly platform: "darwin" | "linux", private readonly macExecutable = "/usr/bin/sandbox-exec") { this.id = platform === "darwin" ? "macos-seatbelt-v1" : "linux-bubblewrap-v1"; }
  async open(request: SandboxRequest): Promise<SandboxSession> {
    const helper = posixSandboxHelper(), bwrap = this.platform === "linux" ? bubblewrapExecutable() : undefined;
    if (!helper || this.platform === "linux" && !bwrap) throw new Error("sandbox_unavailable");
    const reads = await readGrants(request);
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-sandbox-")));
    try {
      for (const [name, content] of Object.entries(request.options.files ?? {})) {
        await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(directory, name), content, { flag: "wx", mode: 0o600 });
      }
      request.options.signal?.throwIfAborted();
      const { policy } = request;
      const limits = [String(policy.timeoutMs), String(policy.memoryBytes), String(policy.cpuSeconds), String(policy.workspaceBytes), String(policy.workspaceFiles), directory];
      let executable: string, args: string[];
      if (this.platform === "darwin") {
        executable = helper;
        args = [...limits, this.macExecutable, "-p", sandboxProfile(request.command, directory, reads), request.command, ...request.args];
      } else {
        executable = bwrap!;
        const mounts = new Set(["/usr", "/lib", "/lib64", "/bin"]);
        // bubblewrap passes inherited descriptors to its payload; there is no
        // --preserve-fds option. The supervisor closes fd 3 in the untrusted child.
        args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
        for (const mount of mounts) if (existsSync(mount)) args.push("--ro-bind", mount, mount);
        for (const read of [{ path: helper }, { path: request.command }, ...reads]) {
          if (![...mounts].some(mount => read.path === mount || read.path.startsWith(mount + "/"))) args.push("--ro-bind", read.path, read.path);
        }
        if (existsSync("/etc/ld.so.cache")) args.push("--ro-bind", "/etc/ld.so.cache", "/etc/ld.so.cache");
        args.push("--bind", directory, directory, "--remount-ro", "/", "--remount-ro", "/tmp", "--remount-ro", "/dev", "--chdir", directory, "--", helper, ...limits, request.command, ...request.args);
      }
      const child = spawn(executable, args, { cwd: directory, shell: false, detached: true, env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, ...(request.options.electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe", "pipe"] });
      return supervise(child as ChildProcessWithoutNullStreams, directory, request, this.id);
    } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
  }
}

function supervise(child: ChildProcessWithoutNullStreams, directory: string, request: SandboxRequest, backend: string): SandboxSession {
  const stdout = new PassThrough(), stderr = new PassThrough();
  let bytes = 0, report = "", finished = false, forced: "cancelled" | "resource_limited" | "unavailable" | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Group exited. */ } };
  const stop = () => { if (finished) return; forced ??= "cancelled"; child.kill("SIGTERM"); killTimer ??= setTimeout(kill, 500); };
  const guard = setTimeout(() => { forced ??= "unavailable"; stop(); }, request.policy.timeoutMs + 3000);
  const completion = new Promise<SandboxResult>(resolve => {
    const result = (value: SandboxResult) => {
      if (finished) return; finished = true; clearTimeout(guard); clearTimeout(killTimer); request.options.signal?.removeEventListener("abort", stop);
      stdout.end(); stderr.end();
      resolve({ ...value, policyId: sandboxPolicyId(request.policy), backend });
    };
    const capture = (stream: PassThrough) => (chunk: Buffer) => {
      const remaining = Math.max(0, request.policy.outputBytes - bytes); bytes += chunk.length;
      if (remaining) { const accepted = chunk.subarray(0, remaining); if (!stream.write(accepted)) { (stream === stdout ? child.stdout : child.stderr).pause(); stream.once("drain", () => (stream === stdout ? child.stdout : child.stderr).resume()); } }
      if (bytes > request.policy.outputBytes) { forced = "resource_limited"; stop(); }
    };
    child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(stderr));
    child.stdio[3]?.on("data", (chunk: Buffer) => { report += chunk.toString("utf8"); if (report.length > 4096) { forced = "unavailable"; stop(); } });
    child.stdin.on("error", () => undefined);
    child.once("error", () => result({ status: "unavailable", stdout: "", stderr: "sandbox_start_failed", exitCode: null }));
    child.once("close", () => {
      let parsed; try { parsed = completionSchema.safeParse(JSON.parse(report)); } catch { /* Missing or invalid receipt is not success. */ }
      const receipt = parsed?.success ? parsed.data : { status: "unavailable" as const, exitCode: null };
      result({ ...receipt, ...(forced ? { status: forced, exitCode: null, ...(forced === "resource_limited" ? { limit: "output" as const } : {}) } : {}), stdout: "", stderr: "" });
    });
  });
  request.options.signal?.addEventListener("abort", stop, { once: true }); if (request.options.signal?.aborted) stop();
  let disposal: Promise<void> | undefined;
  return { directory, stdin: child.stdin, stdout, stderr, completion, stop, dispose: () => disposal ??= (async () => { stop(); await completion; await fs.rm(directory, { recursive: true, force: true }); })() };
}
