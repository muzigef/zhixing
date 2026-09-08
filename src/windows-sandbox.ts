import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod/v4";
import type { SandboxResult, SandboxOptions } from "./local-sandbox.js";

export function windowsSandboxHelper(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [resources ? path.join(resources, "runtime/windows-sandbox.exe") : "", path.join(here, "runtime/windows-sandbox.exe"), path.join(here, "../.build/windows-sandbox.exe")].find(file => file && existsSync(file));
}
const resultSchema = z.object({ status: z.enum(["completed", "timed_out", "unavailable", "cancelled"]), stdout: z.string().max(65536), stderr: z.string().max(65536), exitCode: z.number().int().nullable() });
/** Only a private runtime copy is granted to the package SID. Never alter the
 * installation's ACL, grant home/workspace access, or fall back to plain spawn. */
export async function runWindowsSandbox(command: string, args: readonly string[], options: SandboxOptions): Promise<SandboxResult> {
  const unavailable: SandboxResult = { status: "unavailable", stdout: "", stderr: "Windows AppContainer 沙箱未就绪。", exitCode: null };
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
    await fs.copyFile(resolved, path.join(runtime, path.basename(resolved)));
    let size = (await fs.stat(resolved)).size;
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
      const timer = setTimeout(() => { child.kill(); finish(unavailable); }, 20_000);
      child.stderr.resume(); child.stdin.on("error", () => undefined);
      child.stdout.on("data", (bytes: Buffer) => { output += decoder.write(bytes); if (output.length > 800_000) child.kill(); });
      child.on("error", () => finish(unavailable));
      child.on("close", () => { const result = resultSchema.safeParse((() => { try { return JSON.parse(output); } catch { return undefined; } })()); finish(result.success ? result.data : unavailable); });
      child.stdin.write(JSON.stringify({ root, executable: path.join(runtime, path.basename(resolved)), args: launchArgs, timeoutMs: options.timeoutMs ?? 5000, electronNode: options.electronNode ?? false }) + "\n");
      options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
    });
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
}
