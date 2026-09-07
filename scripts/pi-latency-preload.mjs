// Diagnostic preload. Records timestamps, event names and numeric usage only.
// Never record URLs, headers, payload text, credentials or provider error bodies.
import fs from "node:fs";

const destination = process.env.ZHIXING_PI_LATENCY_TRACE;
const record = (type, extra = {}) => {
  if (destination) fs.appendFileSync(destination, JSON.stringify({ at: Date.now(), type, ...extra }) + "\n", { mode: 0o600 });
};
record("worker_preload");
const NativeWebSocket = globalThis.WebSocket;
if (NativeWebSocket) {
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      record("ws_connect_start");
      super(...args);
      this.addEventListener("open", () => record("ws_open"));
      this.addEventListener("close", () => record("ws_closed"));
      this.addEventListener("error", () => record("ws_error"));
      const seen = new Set();
      this.addEventListener("message", (event) => {
        if (!seen.has("frame")) { seen.add("frame"); record("ws_first_frame"); }
        try {
          const value = JSON.parse(typeof event.data === "string" ? event.data : "null");
          const allowed = ["response.created", "response.in_progress", "response.output_item.added", "response.output_text.delta", "response.reasoning_summary_text.delta", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.completed", "response.failed"];
          if (value && allowed.includes(value.type) && !seen.has(value.type)) {
            seen.add(value.type);
            record(value.type);
          }
        } catch { /* The provider owns frame decoding. */ }
      });
    }
    send(...args) { record("ws_send"); return super.send(...args); }
    close(...args) { record("ws_close_requested"); return super.close(...args); }
  };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  let measured = false;
  try { measured = /\/responses\/?$/.test(new URL(args[0] instanceof Request ? args[0].url : String(args[0])).pathname); } catch { /* Ignore unrelated URLs. */ }
  if (measured) record("http_request_start");
  try {
    const response = await nativeFetch(...args);
    if (measured) record("http_headers", { status: response.status });
    return response;
  } catch (error) { if (measured) record("http_error"); throw error; }
};
process.once("beforeExit", () => record("worker_before_exit"));
