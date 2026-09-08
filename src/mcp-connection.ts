import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod/v4";
import { mcpServerSchema, type McpServer } from "./mcp-settings.js";
import { JsonSchemaWorker } from "./json-schema-worker.js";
import { ToolOutcomeUnknown } from "./tool-harness.js";

const MODERN = "2026-07-28"; const LEGACY = "2025-11-25";
export const toolSchema = z.object({ name: z.string().min(1).max(128), description: z.string().max(4000).optional(), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()).optional() });
export type McpTool = z.infer<typeof toolSchema>;
class RpcError extends Error { constructor(readonly code: number) { super("mcp_remote_error"); } }
export class McpConnection {
  private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private readonly validator = new JsonSchemaWorker();
  private readonly decoder = new StringDecoder("utf8");
  private buffer = ""; private sequence = 0; private received = 0;
  private protocol: string = MODERN;
  private shutdown?: Promise<void>;
  private failed?: Error;
  readonly tools: McpTool[] = [];
  get closed(): boolean { return this.shutdown !== undefined; }
  private constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly directory: string) {
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        this.received += chunk.length; if (this.received > 2_000_000) throw new Error("mcp_output_limit");
        this.buffer += this.decoder.write(chunk); if (Buffer.byteLength(this.buffer) > 128_000) throw new Error("mcp_output_limit");
        for (;;) { const newline = this.buffer.indexOf("\n"); if (newline < 0) break; const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1); this.receive(JSON.parse(line)); }
      } catch { this.fail(new Error("mcp_protocol_error")); }
    });
    child.stderr.resume(); // Never retain server logs: they may contain credentials or paths.
    child.on("error", () => this.fail(new Error("mcp_unavailable")));
    child.on("exit", () => this.fail(new Error("mcp_disconnected")));
    child.stdin.on("error", () => this.fail(new Error("mcp_disconnected")));
  }
  static async open(raw: McpServer, signal: AbortSignal): Promise<McpConnection> {
    const config = mcpServerSchema.parse(raw); signal.throwIfAborted();
    if (!config.enabled) throw new Error("mcp_disabled");
    const executable = await fs.realpath(config.command); const stat = await fs.stat(executable); if (!stat.isFile()) throw new Error("mcp_unavailable");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-mcp-process-"));
    const child = spawn(executable, config.args, { cwd: directory, shell: false, detached: process.platform !== "win32", windowsHide: true,
      env: { PATH: `${path.dirname(executable)}${path.delimiter}/usr/bin${path.delimiter}/bin`, ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: ["pipe", "pipe", "pipe"] });
    const connection = new McpConnection(child, directory);
    try { await connection.initialize(AbortSignal.any([signal, AbortSignal.timeout(8000)])); return connection; } catch (error) { await connection.close(); throw error; }
  }
  private async initialize(signal: AbortSignal): Promise<void> {
    let discovered: unknown;
    try { discovered = await this.request("server/discover", {}, signal, 600); }
    catch (error) {
      signal.throwIfAborted();
      if (this.failed || error instanceof RpcError && [-32020, -32021, -32022].includes(error.code)) throw new Error("mcp_protocol_unsupported");
      if (!(error instanceof RpcError) && !(error instanceof Error && error.message === "mcp_probe_timeout")) throw error;
      this.protocol = LEGACY;
    }
    if (this.protocol === MODERN) {
      const value = z.object({ resultType: z.literal("complete"), supportedVersions: z.array(z.string()), capabilities: z.object({ tools: z.object({}).passthrough().optional() }) }).parse(discovered);
      if (!value.supportedVersions.includes(MODERN) || !value.capabilities.tools) throw new Error("mcp_protocol_unsupported");
    } else {
      const value = z.object({ protocolVersion: z.literal(LEGACY), capabilities: z.object({ tools: z.object({}).passthrough().optional() }) }).parse(await this.request("initialize", { protocolVersion: LEGACY, clientInfo: { name: "zhixing", version: "0.5.0" }, capabilities: {} }, signal));
      if (!value.capabilities.tools) throw new Error("mcp_tools_unavailable"); this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    const cursors = new Set<string>(); let cursor: string | undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, signal);
      const page = z.object({ tools: z.array(toolSchema).max(64), nextCursor: z.string().max(2000).optional() }).parse(this.complete(result));
      this.tools.push(...page.tools); if (this.tools.length > 64 || new Set(this.tools.map(tool => tool.name)).size !== this.tools.length) throw new Error("mcp_tools_limit");
      cursor = page.nextCursor; if (cursor && cursors.has(cursor)) throw new Error("mcp_protocol_error"); if (cursor) cursors.add(cursor);
      if (cursors.size > 8) throw new Error("mcp_tools_limit");
    } while (cursor);
    for (const tool of this.tools) {
      if (JSON.stringify(tool).length > 24_000 || tool.inputSchema.type !== "object") throw new Error("mcp_schema_unsupported");
      await this.validator.check(tool.name, { schema: tool.inputSchema }, signal);
      if (tool.outputSchema) await this.validator.check(`${tool.name}:output`, { schema: tool.outputSchema }, signal);
    }
  }
  async validate(name: string, input: unknown, signal: AbortSignal): Promise<void> {
    if (!this.tools.some(tool => tool.name === name)) throw new Error("mcp_tool_denied");
    if (JSON.stringify(input ?? null).length > 12_000) throw new Error("mcp_input_limit");
    await this.validator.check(name, { input }, signal);
  }
  async call(name: string, input: unknown, signal: AbortSignal, write = false): Promise<unknown> {
    await this.validate(name, input, signal);
    try {
      const result = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string().max(64_000) })).max(32), structuredContent: z.record(z.string(), z.unknown()).optional(), isError: z.boolean().optional() }).parse(this.complete(await this.request("tools/call", { name, arguments: input }, signal)));
      const schema = this.tools.find(tool => tool.name === name)?.outputSchema;
      if (schema && !result.isError) await this.validator.check(`${name}:output`, { input: result.structuredContent }, signal);
      if (write && result.isError) throw new ToolOutcomeUnknown();
      return result;
    } catch (error) { if (write) throw new ToolOutcomeUnknown(); throw error instanceof RpcError ? new Error("mcp_remote_error") : error; }
  }
  private complete(result: unknown): unknown {
    if (this.protocol === MODERN && (!result || typeof result !== "object" || !("resultType" in result) || result.resultType !== "complete")) throw new Error("mcp_result_unsupported");
    return result;
  }
  private request(method: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs = 15_000): Promise<unknown> {
    signal.throwIfAborted(); if (this.closed || this.failed) return Promise.reject(new Error("mcp_disconnected"));
    if (this.pending.size >= 8) return Promise.reject(new Error("mcp_request_limit"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const stop = (timeout: boolean) => {
        if (method !== "initialize") this.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
        finish(); reject(new Error(timeout ? method === "server/discover" ? "mcp_probe_timeout" : "mcp_timeout" : "mcp_cancelled"));
        if (method !== "server/discover" || !timeout) void this.close();
      };
      const abort = () => stop(false);
      const timer = setTimeout(() => stop(true), timeoutMs);
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.pending.delete(id); };
      this.pending.set(id, { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } });
      signal.addEventListener("abort", abort, { once: true });
      this.send({ jsonrpc: "2.0", id, method, params: { ...params, ...(this.protocol === MODERN ? { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientInfo": { name: "zhixing", version: "0.5.0" }, "io.modelcontextprotocol/clientCapabilities": {} } } : {}) } });
    });
  }
  private receive(raw: unknown): void {
    const message = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), result: z.unknown().optional(), error: z.object({ code: z.number().int() }).passthrough().optional() }).parse(raw);
    if (message.method) {
      if (message.id !== undefined) { if (this.protocol === MODERN) throw new Error("mcp_protocol_error"); this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported client capability" } }); }
      return;
    }
    if (message.id === undefined || ("result" in message) === ("error" in message)) throw new Error("mcp_protocol_error");
    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (message.error) pending?.reject(new RpcError(message.error.code)); else pending?.resolve(message.result);
  }
  private send(value: unknown): void { if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(value) + "\n"); }
  private fail(error: Error): void { this.failed = error; for (const pending of [...this.pending.values()]) pending.reject(error); void this.close(); }
  close(): Promise<void> {
    return this.shutdown ??= (async () => {
      for (const pending of [...this.pending.values()]) pending.reject(new Error("mcp_disconnected"));
      this.child.stdin.end();
      const exited = new Promise<void>(resolve => { if (this.child.exitCode !== null || this.child.signalCode !== null || !this.child.pid) resolve(); else this.child.once("exit", () => resolve()); });
      const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal); else this.child.kill(signal); } catch { /* Already exited. */ } };
      let timer: NodeJS.Timeout;
      await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(() => { kill("SIGTERM"); resolve(); }, 300); })]); clearTimeout(timer!);
      await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(() => { kill("SIGKILL"); resolve(); }, 300); })]); clearTimeout(timer!);
      await this.validator.close(); await fs.rm(this.directory, { recursive: true, force: true });
    })();
  }
}
