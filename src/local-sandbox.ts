import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createSandboxPolicy, assertSandboxCapabilities, validateSandboxInputs, sandboxPolicyId } from "./sandbox-policy.js";
import { sandboxBackend } from "./sandbox-backends.js";
import type { SandboxOptions, SandboxResult, SandboxSession, SandboxRequest } from "./sandbox-types.js";
export type { SandboxOptions, SandboxResult, SandboxSession } from "./sandbox-types.js";

/** Sole entry for untrusted code and restricted MCP; failure never falls back to host execution. */
export class LocalSandbox {
  constructor(private readonly macExecutable = "/usr/bin/sandbox-exec") {}
  private async request(command: string, args: readonly string[], options: SandboxOptions, interactive: boolean): Promise<SandboxRequest> {
    if (!(options.allowedCommands ?? []).includes(command) || !path.isAbsolute(command)) throw new Error("sandbox_command_denied");
    if (args.some(arg => typeof arg !== "string" || arg.includes("\0")) || args.length > 256) throw new Error("sandbox_argument_invalid");
    options = { ...options, files: { ...options.files }, readPaths: options.readPaths ? [...options.readPaths] : undefined }; args = [...args];
    const policy = createSandboxPolicy({ ...options.policy, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) });
    validateSandboxInputs(options.files ?? {}, policy); options.signal?.throwIfAborted();
    const backend = sandboxBackend(process.platform, this.macExecutable);
    if (backend) assertSandboxCapabilities(policy, backend.capabilities, interactive);
    const resolved = await fs.realpath(command); if (!(await fs.stat(resolved)).isFile()) throw new Error("sandbox_command_denied");
    const snapshot = { ...options, files: Object.freeze({ ...options.files }), readPaths: options.readPaths ? [...options.readPaths] : undefined };
    return { command: resolved, args: [...args], options: snapshot, policy, interactive };
  }
  async open(command: string, args: readonly string[], options: SandboxOptions = {}): Promise<SandboxSession> {
    const request = await this.request(command, args, options, true);
    const backend = sandboxBackend(process.platform, this.macExecutable);
    if (!backend) throw new Error("sandbox_unavailable");
    return backend.open(request);
  }
  async run(command: string, args: readonly string[], options: SandboxOptions = {}): Promise<SandboxResult> {
    const request = await this.request(command, args, options, false);
    const unavailable: SandboxResult = { status: "unavailable", stdout: "", stderr: "本平台沙箱或所需隔离能力未就绪。", exitCode: null, policyId: sandboxPolicyId(request.policy) };
    const backend = sandboxBackend(process.platform, this.macExecutable);
    if (!backend) return unavailable;
    if (backend.run) return backend.run(request);
    let session: SandboxSession;
    try { session = await backend.open(request); }
    catch (error) { if (error instanceof Error && error.message === "sandbox_unavailable") return unavailable; throw error; }
    const out = new StringDecoder("utf8"), err = new StringDecoder("utf8"); let stdout = "", stderr = "";
    session.stdout.on("data", (chunk: Buffer) => { stdout += out.write(chunk); }); session.stderr.on("data", (chunk: Buffer) => { stderr += err.write(chunk); });
    session.stdin.end();
    try { const result = await session.completion; return { ...result, stdout, stderr: stderr || result.stderr }; }
    finally { await session.dispose(); }
  }
}
