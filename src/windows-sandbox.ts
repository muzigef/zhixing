import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod/v4";
import type { SandboxResult, SandboxOptions, SandboxBackend, SandboxRequest, SandboxSession } from "./sandbox-types.js";
import { createSandboxPolicy, sandboxPolicyId } from "./sandbox-policy.js";

export function windowsSandboxHelper(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [resources ? path.join(resources, "runtime/windows-sandbox.exe") : "", path.join(here, "runtime/windows-sandbox.exe"), path.join(here, "../.build/windows-sandbox.exe")].find(file => file && existsSync(file));
}
const resultSchema = z.object({ status: z.enum(["completed", "timed_out", "unavailable", "cancelled", "resource_limited"]), stdoutBase64: z.string().max(2_666_668), stderrBase64: z.string().max(2_666_668), exitCode: z.number().int().nullable(), limit: z.enum(["memory", "cpu", "output", "workspace"]).optional(), error: z.string().regex(/^(?:win32_\d+_at_\d+|appcontainer_-?\d+|hresult_[A-F0-9]{8}|sandbox_setup_failed)$/).optional(), stage: z.enum(["input", "profile", "permissions", "job", "attributes", "pipes", "create_process", "assign_job", "monitor", "workspace", "capture"]).optional() });
/** Decode only the trusted launcher's bounded protocol; never expose arbitrary exception text. */
export function decodeWindowsSandboxResult(output: string, fallback: SandboxResult): SandboxResult {
  const result = resultSchema.safeParse((() => { try { return JSON.parse(output); } catch { return undefined; } })());
  if (!result.success) return fallback;
  const value = result.data;
  const decode = (text: string) => new StringDecoder("utf8").write(Buffer.from(text, "base64"));
  return { ...fallback, status: value.status, exitCode: value.exitCode, ...(value.limit ? { limit: value.limit } : {}), stdout: decode(value.stdoutBase64),
    stderr: value.status === "unavailable" ? `${fallback.stderr} [${value.stage ?? "input"}:${value.error ?? "sandbox_setup_failed"}]` : decode(value.stderrBase64) };
}
/** Only a private runtime copy is granted to the package SID. Never alter the
 * installation's ACL, grant home/workspace access, or fall back to plain spawn. */
async function runWindowsSandbox(command: string, args: readonly string[], options: SandboxOptions): Promise<SandboxResult> {
  const policy = createSandboxPolicy(options.policy);
  const unavailable: SandboxResult = { status: "unavailable", stdout: "", stderr: "Windows AppContainer 沙箱未就绪。", exitCode: null, policyId: sandboxPolicyId(policy), backend: "windows-appcontainer-v1" };
  const helper = windowsSandboxHelper(); if (!helper || process.platform !== "win32") return unavailable;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-appcontainer-"));
  const work = path.join(root, "work"), runtime = path.join(root, "runtime");
  try {
    await fs.mkdir(work); await fs.mkdir(runtime);
    const resolved = await fs.realpath(command);
    // Inputs are private regular-file copies, so Node need not lstat every
    // ancestor up to the host drive root while resolving modules. Do not grant
    // drive/home metadata access just to satisfy its default realpath walk.
    const nodeRuntime = options.electronNode || /^node\.exe$/i.test(path.basename(resolved));
    // Electron otherwise reopens NUL, despite already inheriting valid stdio.
    const launchArgs = [...(options.electronNode ? ["--no-stdio-init"] : []), ...(nodeRuntime ? ["--preserve-symlinks", "--preserve-symlinks-main"] : []), ...args];
    if (!(await fs.stat(resolved)).isFile()) return unavailable;
    let size = (await fs.stat(resolved)).size;
    if (size > 400_000_000) throw new Error("sandbox_runtime_limit");
    await fs.copyFile(resolved, path.join(runtime, path.basename(resolved)));
    // Node/Electron runtime dependencies only, not adjacent project sources.
    for (const entry of await fs.readdir(path.dirname(resolved), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:dll|pak|bin|dat)$/i.test(entry.name)) continue;
      const source = path.join(path.dirname(resolved), entry.name); size += (await fs.stat(source)).size;
      if (size > 400_000_000) throw new Error("sandbox_runtime_limit");
      await fs.copyFile(source, path.join(runtime, entry.name));
    }
    if (/^python(?:3(?:\.\d+)?)?\.exe$/i.test(path.basename(resolved))) {
      // Python is explicitly resolved by the trusted runner. Copy stdlib only;
      // user site-packages and scripts never enter the sandbox.
      for (const name of ["Lib", "DLLs"]) {
        const source = path.join(path.dirname(resolved), name);
        await fs.cp(source, path.join(runtime, name), { recursive: true, filter: async file => {
          const stat = await fs.lstat(file); if (stat.isSymbolicLink() || path.basename(file).toLowerCase() === "site-packages") return false;
          if (stat.isFile()) { size += stat.size; if (size > 400_000_000) throw new Error("sandbox_runtime_limit"); }
          return true;
        } });
      }
    }
    let total = 0;
    for (const [name, content] of Object.entries(options.files ?? {})) {
      if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.split("/").some(part => !part || part === "." || part === ".." || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part) || /[. ]$/.test(part)) || name.split("/").length > 5) throw new Error("sandbox_file_denied");
      total += Buffer.byteLength(content); if (total > 2_000_000) throw new Error("sandbox_input_limit");
      await fs.mkdir(path.dirname(path.join(work, name)), { recursive: true });
      await fs.writeFile(path.join(work, name), content, { flag: "wx" });
    }
    if (options.signal?.aborted) return { ...unavailable, status: "cancelled", stderr: "" };
    return await new Promise<SandboxResult>(resolve => {
      // CreateProcess resolves the package profile from the host's LOCALAPPDATA.
      // This goes to the trusted launcher only; its child receives a separate environment.
      const child = spawn(helper, [], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: process.env.LOCALAPPDATA } });
      let output = "", completed = false;
      const decoder = new StringDecoder("utf8");
      const abort = () => { if (!child.stdin.destroyed) child.stdin.end("cancel\n"); };
      const finish = (result: SandboxResult) => { if (completed) return; completed = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); child.stdin.destroy(); resolve(result); };
      const timer = setTimeout(() => { child.kill(); finish(unavailable); }, policy.timeoutMs + 20_000);
      child.stderr.resume(); child.stdin.on("error", () => undefined);
      child.stdout.on("data", (bytes: Buffer) => { output += decoder.write(bytes); if (output.length > 2 * policy.outputBytes + 4096) child.kill(); });
      child.on("error", () => finish(unavailable));
      child.on("close", () => finish(decodeWindowsSandboxResult(output, unavailable)));
      child.stdin.write(JSON.stringify({ root, executable: path.join(runtime, path.basename(resolved)), args: launchArgs, policy, electronNode: options.electronNode ?? false }) + "\n");
      options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
    });
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
}

export class WindowsSandboxBackend implements SandboxBackend {
  readonly id = "windows-appcontainer-v1";
  readonly capabilities = { memory: "hard" as const, interactive: false };
  async open(): Promise<SandboxSession> { throw new Error("sandbox_capability_unavailable"); }
  async run(request: SandboxRequest): Promise<SandboxResult> {
    // External read grants/interactive stdio are not implemented by the private-copy runner.
    if (request.options.readPaths?.length) throw new Error("sandbox_capability_unavailable");
    return runWindowsSandbox(request.command, request.args, { ...request.options, policy: request.policy, timeoutMs: request.policy.timeoutMs });
  }
}
