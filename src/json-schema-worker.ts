import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Schema compilation and regex validation run off the application thread with a deadline.
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const Ajv = require(workerData.ajv).default;
const addFormats = require(workerData.formats).default;
const validators = new Map();
parentPort.on('message', message => {
  try {
    if (message.schema) {
      const ajv = new Ajv({ strict: true, strictTypes: false, strictTuples: false, logger: false, allErrors: false, ownProperties: true });
      addFormats(ajv); validators.set(message.name, ajv.compile(message.schema));
      parentPort.postMessage({ id: message.id, ok: true });
    } else parentPort.postMessage({ id: message.id, ok: validators.get(message.name)(message.input) === true });
  } catch { parentPort.postMessage({ id: message.id, ok: false }); }
});`;
export class JsonSchemaWorker {
  private readonly worker: Worker;
  private sequence = 0;
  private ended = false;
  private pending = new Map<number, { finish: (ok: boolean) => void; timer: NodeJS.Timeout }>();
  constructor() {
    this.worker = new Worker(workerSource, { eval: true, env: {}, workerData: { ajv: require.resolve("ajv/dist/2020.js"), formats: require.resolve("ajv-formats") }, resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 } });
    this.worker.on("message", (message: { id: number; ok: boolean }) => { const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); pending.finish(message.ok === true); } });
    this.worker.on("error", () => { void this.close(); }); this.worker.on("exit", () => { void this.close(); });
  }
  async check(name: string, value: { schema: unknown } | { input: unknown }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (this.ended || this.pending.size >= 8) throw new Error("mcp_schema_unavailable");
    const ok = await new Promise<boolean>(resolve => {
      const id = ++this.sequence;
      const abort = () => { void this.close(); };
      const finish = (valid: boolean) => { signal.removeEventListener("abort", abort); resolve(valid); };
      this.pending.set(id, { finish, timer: setTimeout(abort, "schema" in value ? 3000 : 1000) });
      signal.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ id, name, ...value });
    });
    signal.throwIfAborted(); if (!ok) throw new Error("schema" in value ? "mcp_schema_unsupported" : "mcp_input_invalid");
  }
  async close(): Promise<void> {
    if (this.ended) return; this.ended = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.finish(false); } this.pending.clear();
    await this.worker.terminate();
  }
}
