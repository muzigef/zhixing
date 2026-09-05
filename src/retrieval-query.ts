import type { SearchResult } from "./contracts.js";
const synonyms = [
  ["缓存", "cache", "caching"], ["失效", "旧数据", "过期", "invalidation", "stale"],
  ["检索", "retrieval", "搜索", "search"], ["重排", "rerank", "reranking", "重新排序"],
  ["微调", "fine-tuning", "finetuning"], ["嵌入", "embedding", "向量"],
  ["并发", "concurrency", "concurrent"], ["事务", "transaction"], ["隔离", "isolation"],
  ["引用", "citation", "出处", "来源"], ["取消", "cancellation", "中断"], ["幂等", "idempotency", "重复写入"],
];
const stop = new Set(["请", "根据", "资料", "解释", "为什么", "如何", "什么", "怎么", "这个", "这些", "当前", "主题", "回答", "问题", "说明", "已经", "导入", "给出", "一个", "进行", "the", "and", "what", "how", "is", "of", "in"]);
export function expandQuery(query: string): string[] {
  const text = query.toLowerCase().slice(0, 400);
  const words = [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)].filter((item) => item.isWordLike).map((item) => item.segment);
  const expanded = synonyms.filter((group) => group.some((term) => text.includes(term))).flat();
  return [...new Set([...expanded, ...words].filter((word) => word.length >= 2 && !stop.has(word)))].slice(0, 32);
}
export function rankEvidence(candidates: SearchResult[], terms: string[]): SearchResult[] {
  return candidates.map((item) => {
    const text = item.text.toLowerCase();
    const matched = terms.filter((term) => text.includes(term));
    // Hash-vector collisions never establish relevance in the lexical fallback.
    const score = matched.reduce((sum, term) => sum + Math.min(8, term.length), 0) / Math.sqrt(Math.max(100, text.length));
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || String(a.citation.chunkId).localeCompare(String(b.citation.chunkId))).slice(0, 8);
}
