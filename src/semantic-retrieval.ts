import { DOCUMENT_INDEX_RECIPE } from "./document-index-recipe.js";
import { z } from "zod/v4";
import { cosineSimilarity } from "./embedding.js";
import type { ZhixingDatabase } from "./database.js";
import type { SearchResult } from "./contracts.js";
import { abortable } from "./abortable.js";
import { withSourceVersion } from "./source-version.js";

export interface SemanticEmbedding { readonly id: string; embed(texts: string[], signal: AbortSignal): Promise<number[][]>; }
const vectorSchema = z.array(z.number().finite()).min(2).max(8192).refine((vector) => Math.hypot(...vector) > 0);
async function localJson(route: string, init: RequestInit, parent: AbortSignal): Promise<unknown> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(route === "tags" ? 2000 : 15000)]);
  const response = await abortable(() => fetch(`http://127.0.0.1:11434/api/${route}`, { ...init, signal, redirect: "error" }), signal);
  if (!response.ok || !response.body) { void response.body?.cancel(); throw new Error("semantic_model_unavailable"); }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const item = await abortable(() => reader.read(), signal); if (item.done) break; size += item.value.length; if (size > 2_000_000) throw new Error("semantic_output_limit"); parts.push(item.value); }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally { void reader.cancel().catch(() => undefined); }
}
/** Fixed loopback endpoint, no redirects, automatic model downloads or remote document uploads. */
export class OllamaEmbedding implements SemanticEmbedding {
  private constructor(readonly id: string, private readonly model: string) {}
  static async connect(model: string, signal: AbortSignal): Promise<OllamaEmbedding> {
    z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/).parse(model);
    const result = z.object({ models: z.array(z.object({ name: z.string(), digest: z.string().min(1).max(128) })).max(500) }).parse(await localJson("tags", { method: "GET" }, signal));
    const found = result.models.find((item) => item.name === model || item.name === `${model}:latest`);
    if (!found) throw new Error("semantic_model_unavailable");
    return new OllamaEmbedding(`ollama:${found.name}@${found.digest}`, found.name);
  }
  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    if (texts.length > 16 || texts.some((text) => text.length > 4000)) throw new Error("semantic_input_limit");
    if ((await OllamaEmbedding.connect(this.model, signal)).id !== this.id) throw new Error("semantic_model_changed");
    const result = z.object({ embeddings: z.array(vectorSchema).max(16) }).parse(await localJson("embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, input: texts, truncate: false, keep_alive: "5m" }) }, signal));
    if (result.embeddings.length !== texts.length || new Set(result.embeddings.map((item) => item.length)).size !== 1) throw new Error("semantic_output_invalid");
    if ((await OllamaEmbedding.connect(this.model, signal)).id !== this.id) throw new Error("semantic_model_changed");
    return result.embeddings;
  }
}
interface Chunk { id: string; text: string; hash: string; }
export const SEMANTIC_INDEX_RECIPE = "semantic-v2-verbatim-query400-cosine035";
export class SemanticIndex {
  private readonly modelKey: string;
  private readonly modelId: string;
  constructor(private readonly database: ZhixingDatabase, private readonly model: SemanticEmbedding) {
    this.modelId = model.id; this.modelKey = JSON.stringify([SEMANTIC_INDEX_RECIPE, DOCUMENT_INDEX_RECIPE, model.id]);
    database.db.exec("CREATE TABLE IF NOT EXISTS semantic_embeddings (chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, model TEXT NOT NULL, content_hash TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(chunk_id, model))");
  }
  private current(chunk: { id: string; hash: string }): boolean {
    if (this.model.id !== this.modelId) throw new Error("semantic_model_changed");
    return Boolean(this.database.db.prepare("SELECT 1 FROM chunks c JOIN documents d ON d.id=c.document_id JOIN document_indexes i ON i.document_id=d.id WHERE c.id=? AND c.content_hash=? AND i.recipe=? AND d.status IN ('indexed','ocr_low_confidence','ocr_partial')").get(chunk.id, chunk.hash, DOCUMENT_INDEX_RECIPE));
  }
  indexedCount(topic: string): number { return (this.database.db.prepare("SELECT count(*) AS count FROM semantic_embeddings e JOIN chunks c ON c.id=e.chunk_id JOIN documents d ON d.id=c.document_id JOIN document_indexes i ON i.document_id=d.id WHERE c.topic_id=? AND e.model=? AND e.content_hash=c.content_hash AND i.recipe=? AND d.status IN ('indexed','ocr_low_confidence','ocr_partial')").get(topic, this.modelKey, DOCUMENT_INDEX_RECIPE) as { count: number }).count; }
  async build(topic: string, signal: AbortSignal): Promise<{ indexed: number }> {
    let after = 0; let indexed = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunks = this.database.db.prepare("SELECT c.rowid AS position, c.id, c.text, c.content_hash AS hash FROM chunks c JOIN documents d ON d.id=c.document_id JOIN document_indexes i ON i.document_id=d.id WHERE c.topic_id=? AND i.recipe=? AND d.status IN ('indexed','ocr_low_confidence','ocr_partial') AND c.rowid>? ORDER BY c.rowid LIMIT 16").all(topic, DOCUMENT_INDEX_RECIPE, after) as (Chunk & { position: number })[];
      if (!chunks.length) return { indexed };
      if (indexed + chunks.length > 5000) throw new Error("semantic_index_limit");
      const missing = chunks.filter((chunk) => !this.database.db.prepare("SELECT 1 FROM semantic_embeddings WHERE chunk_id=? AND model=? AND content_hash=?").get(chunk.id, this.modelKey, chunk.hash));
      if (missing.length) {
        const vectors = await this.model.embed(missing.map((chunk) => chunk.text), signal); signal.throwIfAborted();
        if (vectors.length !== missing.length) throw new Error("semantic_output_invalid");
        this.database.db.transaction(() => {
          if (missing.some(chunk => !this.current(chunk))) throw new Error("semantic_source_changed");
          missing.forEach((chunk, index) => { const vector = vectorSchema.parse(vectors[index]); this.database.db.prepare("INSERT OR REPLACE INTO semantic_embeddings(chunk_id, model, content_hash, vector) VALUES (?, ?, ?, ?)").run(chunk.id, this.modelKey, chunk.hash, JSON.stringify(vector)); });
        })();
      }
      indexed += chunks.length; after = chunks.at(-1)!.position;
    }
  }
  async search(topic: string, query: string, signal: AbortSignal): Promise<SearchResult[]> {
    signal.throwIfAborted();
    const rows = this.database.db.prepare(`SELECT c.id AS chunkId, c.content_hash AS hash, c.text, c.page_number AS pageNumber, c.anchor, d.id AS documentId, d.name AS documentName, e.vector FROM semantic_embeddings e JOIN chunks c ON c.id=e.chunk_id JOIN documents d ON d.id=c.document_id JOIN document_indexes i ON i.document_id=d.id WHERE c.topic_id=? AND e.model=? AND i.recipe=? AND e.content_hash=c.content_hash AND d.status IN ('indexed','ocr_low_confidence','ocr_partial') LIMIT 5000`).all(topic, this.modelKey, DOCUMENT_INDEX_RECIPE) as { chunkId: string; hash: string; text: string; pageNumber: number | null; anchor: string | null; documentId: string; documentName: string; vector: string }[];
    if (!rows.length) return [];
    const [vector] = await this.model.embed([query.slice(0, 400)], signal); signal.throwIfAborted();
    vectorSchema.parse(vector);
    if (rows.some(row => !this.current({ id: row.chunkId, hash: row.hash }))) throw new Error("semantic_source_changed");
    return this.database.withExtraction(rows.map(({ vector: stored, ...row }) => withSourceVersion({ text: row.text, score: cosineSimilarity(vector!, vectorSchema.parse(JSON.parse(stored))), citation: { topicId: topic, chunkId: row.chunkId, pageNumber: row.pageNumber, anchor: row.anchor, documentId: row.documentId, documentName: row.documentName } })).filter((item) => item.score >= .35).sort((a, b) => b.score - a.score).slice(0, 8));
  }
}

export function fuseEvidence(lexical: SearchResult[], semantic: SearchResult[]): SearchResult[] {
  const candidates = new Map<string, SearchResult>();
  for (const list of [lexical, semantic]) list.forEach((item, rank) => { const key = item.citation.chunkId ?? `${item.citation.documentId}:${item.text}`; const prior = candidates.get(key); candidates.set(key, { ...item, score: (prior?.score ?? 0) + 1 / (60 + rank) }); });
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}
