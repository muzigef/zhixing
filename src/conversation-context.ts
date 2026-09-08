import { expandQuery } from "./retrieval-query.js";
export interface ContextMessage { readonly role: string; readonly text: string; readonly status?: string; readonly images?: readonly import("./image-input.js").ImageInput[]; }

/** Loss-bounded excerpts for model context. The complete transcript stays in its store. */
export function excerpt(text: string, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("context_budget_invalid");
  if (text.length <= limit) return text;
  const marker = "\n[…已省略中间内容，完整记录仍保存在本地…]\n";
  const safe = (part: string) => part.replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "");
  if (limit <= marker.length) return safe(text.slice(0, limit));
  const head = Math.max(0, Math.floor((limit - marker.length) * 0.7));
  return `${safe(text.slice(0, head))}${marker}${safe(text.slice(-(limit - marker.length - head)))}`;
}

/** Preserve a query-relevant middle passage as well as the beginning and ending. */
export function relevantExcerpt(text: string, limit: number, query: string): string {
  if (text.length <= limit || limit < 300) return excerpt(text, limit);
  const terms = expandQuery(query);
  const lower = text.toLowerCase();
  const available = limit - 120;
  const head = Math.floor(available * 0.3), tail = Math.floor(available * 0.2), width = Math.floor(available * 0.5);
  const candidates = terms.map(term => lower.indexOf(term, head)).filter(index => index >= head && index < text.length - tail);
  if (!candidates.length) return excerpt(text, limit);
  const windows = candidates.map(index => {
    const start = Math.max(head, Math.min(index - Math.floor(width / 3), text.length - tail - width));
    const content = lower.slice(start, start + width);
    return { start, score: terms.filter(term => content.includes(term)).length };
  }).sort((a, b) => b.score - a.score || b.start - a.start);
  const start = windows[0]!.start;
  const safe = (part: string) => part.replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "");
  return `${safe(text.slice(0, head))}\n[…省略；以下为原文第 ${start + 1} 字起的相关片段…]\n${safe(text.slice(start, start + width))}\n[…省略；以下为原文结尾…]\n${safe(text.slice(-tail))}`;
}

export function selectConversationContext(messages: readonly ContextMessage[], budget = 40_000, query = "") {
  const goal = excerpt(messages.find((message) => message.role === "user")?.text ?? "", 4_000);
  const history: { role: string; content: string; status: string; images?: readonly import("./image-input.js").ImageInput[] }[] = [];
  let remaining = Math.max(0, budget - goal.length);
  for (const message of [...messages].reverse()) {
    if (remaining < 100 || history.length >= 24) break;
    const content = relevantExcerpt(message.text, Math.min(6_000, remaining), query);
    history.unshift({ role: message.role, content, status: message.status ?? "completed", ...(message.images ? { images: message.images } : {}) });
    remaining -= content.length;
  }
  return { goal, history, omittedMessages: Math.max(0, messages.length - history.length) };
}
