import { abortable } from "./abortable.js";

/** Bounds both a single SSE frame and the entire response, including a stalled reader. */
export async function* responseFrames(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  if (!response.body) throw new Error("provider_protocol_error");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  const streaming = response.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "", bytes = 0;
  try {
    for (;;) {
      const chunk = await abortable(() => reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error("provider_output_limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (streaming) {
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
          if (Buffer.byteLength(frame) > 256 * 1024) throw new Error("provider_output_limit");
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data.trim() && data.trim() !== "[DONE]") yield parse(data);
        }
        if (Buffer.byteLength(buffer) > 256 * 1024) throw new Error("provider_output_limit");
      }
    }
    buffer += decoder.decode();
    if (!streaming) yield parse(buffer);
    else if (buffer.trim() && !buffer.trim().startsWith(":")) throw new Error("provider_incomplete");
  } finally { void reader.cancel().catch(() => undefined); }
}
function parse(data: string): unknown { try { return JSON.parse(data); } catch { throw new Error("provider_protocol_error"); } }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provider_protocol_error");
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("provider_protocol_error"); return value; }
export function string(value: unknown, max = 256_000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("provider_protocol_error"); return value;
}
