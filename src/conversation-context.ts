export interface ContextMessage { readonly role: string; readonly text: string; readonly status?: string; }

/** Loss-bounded excerpts for model context. The complete transcript stays in its store. */
export function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[…已省略中间内容，完整记录仍保存在本地…]\n";
  const head = Math.max(0, Math.floor((limit - marker.length) * 0.7));
  return `${text.slice(0, head)}${marker}${text.slice(-(limit - marker.length - head))}`;
}

export function selectConversationContext(messages: readonly ContextMessage[], budget = 40_000) {
  const goal = excerpt(messages.find((message) => message.role === "user")?.text ?? "", 4_000);
  const history: { role: string; content: string; status: string }[] = [];
  let remaining = Math.max(0, budget - goal.length);
  for (const message of [...messages].reverse()) {
    if (remaining < 100 || history.length >= 24) break;
    const content = excerpt(message.text, Math.min(6_000, remaining));
    history.unshift({ role: message.role, content, status: message.status ?? "completed" });
    remaining -= content.length;
  }
  return { goal, history, omittedMessages: Math.max(0, messages.length - history.length) };
}
