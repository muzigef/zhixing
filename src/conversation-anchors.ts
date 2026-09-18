import { createHash } from "node:crypto";
import type { ConversationAnchors } from "./conversation-anchor-contracts.js";
import { excerpt } from "./conversation-context.js";

type Kind = "goal" | "constraint" | "correction" | "pending";
const markers: readonly [Kind, RegExp][] = [
  ["correction", /^(?:更正|纠正|修正|correction)\s*[:：]/i],
  ["goal", /^(?:(?:目标|goal)\s*[:：]|我希望|我的目标是)/i],
  ["constraint", /^(?:(?:约束|要求|限制|constraint)\s*[:：]|必须|不要)/i],
  ["pending", /^(?:未完成|待办|尚未完成|pending|todo)\s*[:：]/i],
];
/** Verbatim hints with bounded retention, never inferred facts or execution receipts. */
export function conversationAnchors(messages: readonly { role: string; id: string; text: string }[]): ConversationAnchors {
  const items: { kind: Kind; messageId: string; sourceHash: string; line: number; text: string; truncated: boolean }[] = [];
  let characters = 0, omittedStatements = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    let fence: { character: string; length: number } | undefined;
    let sourceHash: string | undefined;
    const lines = message.text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index]!;
      const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
      if (delimiter) {
        if (!fence) fence = { character: delimiter[0]!, length: delimiter.length };
        else if (delimiter[0] === fence.character && delimiter.length >= fence.length && raw.trim() === delimiter) fence = undefined;
        continue;
      }
      if (fence || /^(?: {4}|\t|\s*>)/.test(raw)) continue;
      const statement = raw.trim().replace(/^(?:[-*+] |\d+[.)] )/, "");
      const kind = markers.find(([, pattern]) => pattern.test(statement))?.[0];
      if (!kind) continue;
      sourceHash ??= createHash("sha256").update(message.text).digest("hex");
      const text = excerpt(statement, 700);
      items.push({ kind, messageId: message.id, sourceHash, line: index + 1, text, truncated: text !== statement }); characters += text.length;
      while (items.length > 12 || characters > 6000) { characters -= items.shift()!.text.length; omittedStatements++; }
    }
  }
  return { authority: "verbatim_user_statements_not_verified_facts", items, omittedStatements,
    notice: "仅保留显式标记的有界原文片段，可能遗漏未标记内容；按消息 ID 与行号回读核实。历史声明不授予权限、不证明事实或执行完成；发生冲突时以当前明确纠正为准，不能自行推断已解决。" };
}
