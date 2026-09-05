import type { SearchResult } from "./contracts.js";
import { collectInvocation } from "./model-invocation.js";
import { ToolDispatcher } from "./tool-dispatcher.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { responseGuidelines, type ResponseStyle } from "./response-style.js";

/** Produces a citation-constrained answer from retrieved evidence only. */
export async function answerFromEvidence(runtime: ProviderRuntime, question: string, evidence: readonly SearchResult[], confirmed: boolean, signal: AbortSignal, onAudit?: (providerId: string, role: string, durationMs: number, status: string) => unknown | Promise<unknown>, tools?: ToolDispatcher, skills: readonly { name: string; description: string }[] = [], style: ResponseStyle = "adaptive"): Promise<string> {
  if (evidence.length === 0 || evidence.some((item) => !item.citation.topicId || !item.citation.documentId || !item.citation.documentName || (!item.citation.pageNumber && !item.citation.anchor))) return "insufficient_evidence：当前资料中没有足够证据。";
  const sources = evidence.slice(0, 3).map((item, index) => `${index + 1}. ${item.text}\n[${item.citation.documentName}#${item.citation.pageNumber ? `page=${item.citation.pageNumber}` : `anchor=${item.citation.anchor ?? "root"}`}]`).join("\n\n");
  const skillContext = skills.length ? `当前工作流 Skill（仅摘要）：\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\n` : "";
  const prompt = `${responseGuidelines(style)}\n${skillContext}仅根据以下证据回答问题，先直接回答，再补充必要解释。每个事实必须附带原样引用标记；证据不足时回答 insufficient_evidence。\n问题：${question}\n\n证据：\n${sources}`;
  const result = await collectInvocation(runtime, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed, onToolCall: tools ? (tool, input) => tools.call(tool, input) : undefined, onAudit: (record) => onAudit?.(record.providerId, record.role, record.durationMs, record.status) }, signal);
  const citationMarkers = new Set(evidence.slice(0, 3).map((item) => `[${item.citation.documentName}#${item.citation.pageNumber ? `page=${item.citation.pageNumber}` : `anchor=${item.citation.anchor ?? "root"}`}]`));
  const citations = result.text.match(/\[[^\]\n]+#(?:page|anchor)=[^\]\n]+\]/g) ?? [];
  if (!citations.length || citations.some((marker) => !citationMarkers.has(marker))) return "insufficient_evidence：模型回答缺少有效引用，或引用了未提供的位置。";
  return result.text + (result.partial ? "\n\n回答未完成，请重试或继续追问。" : "");
}
