import { abortable } from "./abortable.js";
import type { FetchLike } from "./chat-completions-client.js";

const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;

/** Only explicit admission rejections are replayed. A dropped POST/stream may already be billable. */
export async function fetchModelResponse(fetcher: FetchLike, url: string, init: RequestInit & { signal: AbortSignal }, deadlineAt: number): Promise<{ response: Response; attempts: number; retryWaitMs: number }> {
  const remaining = deadlineAt - Date.now();
  init.signal.throwIfAborted();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new DOMException("provider_timeout", "TimeoutError");
  const signal = AbortSignal.any([init.signal, AbortSignal.timeout(Math.ceil(remaining))]);
  const request = { ...init, signal };
  let retryWaitMs = 0;
  for (let attempts = 1; ; attempts++) {
    signal.throwIfAborted();
    // Transport exceptions are deliberately not caught: execution/consumption is unknown.
    const response = await abortable(() => fetcher(url, request), signal);
    const header = response.headers.get("retry-after");
    const retryAfter = parseRetryAfter(header);
    const rejected = response.status === 429 || response.status === 503 && retryAfter !== undefined;
    const jitter = Math.floor((0.5 + Math.random() * 0.5) * 250 * 2 ** (attempts - 1));
    const delay = Math.max(jitter, retryAfter ?? 0);
    if (!rejected || attempts >= MAX_ATTEMPTS || delay > MAX_BACKOFF_MS || Date.now() + delay >= deadlineAt) return { response, attempts, retryWaitMs };
    void response.body?.cancel().catch(() => undefined);
    const started = Date.now();
    await wait(delay, signal);
    retryWaitMs += Math.max(0, Date.now() - started);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - Date.now()) : undefined;
}
async function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
