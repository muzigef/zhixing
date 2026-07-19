import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MemoryInput, SearchResult, TopicId } from "./contracts.js";
import { cosineSimilarity } from "./embedding.js";

export class ZhixingDatabase {
  readonly db: Database.Database;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL,
        mime_type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(topic_id, sha256)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER, anchor TEXT, text TEXT NOT NULL, content_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_topic_document ON chunks(topic_id, document_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_id UNINDEXED, topic_id UNINDEXED, text);
      CREATE TABLE IF NOT EXISTS citations (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, page_number INTEGER, anchor TEXT
      );
      CREATE INDEX IF NOT EXISTS citations_document ON citations(topic_id, document_id, chunk_id);
      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE, topic_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL, vector_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunk_embeddings_topic ON chunk_embeddings(topic_id);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, memory_type TEXT NOT NULL, content TEXT NOT NULL,
        source_kind TEXT NOT NULL, source_ref TEXT NOT NULL, confidence REAL NOT NULL,
        confirmed_at TEXT, deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_topic_type ON memories(topic_id, memory_type, deleted_at);
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, action_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, status TEXT NOT NULL, state_version INTEGER NOT NULL DEFAULT 1,
        started_at TEXT NOT NULL, finished_at TEXT, error_code TEXT,
        UNIQUE(topic_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS workflow_steps (
        run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
        step_id TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL, detail TEXT,
        PRIMARY KEY(run_id, step_id)
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(3, new Date().toISOString());
  }

  addDocument(id: string, topicId: TopicId, sha256: string, name: string, mimeType: string, status = "indexed"): boolean {
    const result = this.db.prepare("INSERT OR IGNORE INTO documents(id, topic_id, sha256, name, mime_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, topicId, sha256, name, mimeType, status, new Date().toISOString());
    return result.changes > 0;
  }

  addChunk(id: string, topicId: TopicId, documentId: string, text: string, pageNumber: number | null, anchor: string | null, hash: string): void {
    this.db.prepare("INSERT INTO chunks(id, topic_id, document_id, page_number, anchor, text, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, topicId, documentId, pageNumber, anchor, text, hash);
    this.db.prepare("INSERT INTO chunks_fts(chunk_id, topic_id, text) VALUES (?, ?, ?)").run(id, topicId, text);
    this.db.prepare("INSERT INTO citations(id, topic_id, document_id, chunk_id, page_number, anchor) VALUES (?, ?, ?, ?, ?, ?)").run(`citation:${id}`, topicId, documentId, id, pageNumber, anchor);
  }

  addEmbedding(chunkId: string, topicId: TopicId, vector: readonly number[]): void {
    this.db.prepare("INSERT OR REPLACE INTO chunk_embeddings(chunk_id, topic_id, dimensions, vector_json) VALUES (?, ?, ?, ?)").run(chunkId, topicId, vector.length, JSON.stringify(vector));
  }

  findDocument(topicId: TopicId, sha256: string): { id: string; status: string } | undefined {
    return this.db.prepare("SELECT id, status FROM documents WHERE topic_id = ? AND sha256 = ?").get(topicId, sha256) as { id: string; status: string } | undefined;
  }

  listDocuments(topicId: TopicId): Array<{ id: string; name: string; status: string; createdAt: string }> {
    return this.db.prepare("SELECT id, name, status, created_at AS createdAt FROM documents WHERE topic_id = ? ORDER BY created_at DESC").all(topicId) as Array<{ id: string; name: string; status: string; createdAt: string }>;
  }

  documentImpact(topicId: TopicId, documentId: string): { documentId: string; name: string; chunks: number } | undefined {
    return this.db.prepare(`SELECT d.id AS documentId, d.name AS name, count(c.id) AS chunks
      FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
      WHERE d.topic_id = ? AND d.id = ? GROUP BY d.id`).get(topicId, documentId) as { documentId: string; name: string; chunks: number } | undefined;
  }

  deleteDocument(topicId: TopicId, documentId: string): { name: string; chunks: number } | undefined {
    const impact = this.documentImpact(topicId, documentId);
    if (!impact) return undefined;
    const remove = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)").run(documentId);
      this.db.prepare("DELETE FROM documents WHERE id = ? AND topic_id = ?").run(documentId, topicId);
    });
    remove();
    return { name: impact.name, chunks: impact.chunks };
  }

  search(topicId: TopicId, query: string): SearchResult[] {
    const rows = this.db.prepare(`SELECT c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor, bm25(chunks_fts) AS score
      FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.chunk_id JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ? AND chunks_fts.topic_id = ? ORDER BY score LIMIT 8`).all(query, topicId) as Array<{ text: string; documentId: string; documentName: string; pageNumber: number | null; anchor: string | null; score: number }>;
    return rows.map((row) => ({ text: row.text, score: row.score, citation: { topicId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, anchor: row.anchor } }));
  }

  hybridSearch(topicId: TopicId, query: string, queryVector: readonly number[]): SearchResult[] {
    const lexical = this.search(topicId, query);
    const lexicalRank = new Map(lexical.map((item, index) => [item.citation.documentId + item.text, 1 / (index + 1)]));
    const rows = this.db.prepare(`SELECT c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor, e.vector_json AS vectorJson
      FROM chunks c JOIN documents d ON d.id = c.document_id LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
      WHERE c.topic_id = ? AND d.status IN ('indexed', 'ocr_low_confidence')`).all(topicId) as Array<{ text: string; documentId: string; documentName: string; pageNumber: number | null; anchor: string | null; vectorJson: string | null }>;
    return rows.map((row) => {
      const vector = row.vectorJson ? JSON.parse(row.vectorJson) as number[] : [];
      const semantic = Math.max(0, cosineSimilarity(queryVector, vector));
      const lexicalScore = lexicalRank.get(row.documentId + row.text) ?? 0;
      return { text: row.text, score: lexicalScore * 0.65 + semantic * 0.35, citation: { topicId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, anchor: row.anchor } };
    }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 8);
  }

  writeMemory(id: string, input: MemoryInput): void {
    if (!input.confirmed && input.sourceKind === "user") throw new Error("denied: 用户记忆需要确认");
    if (input.sourceKind === "document" && !input.sourceRef) throw new Error("denied: 知识记忆必须有引用");
    this.db.prepare("INSERT INTO memories(id, topic_id, memory_type, content, source_kind, source_ref, confidence, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.topicId, input.type, input.content, input.sourceKind, input.sourceRef, input.confidence, input.confirmed ? new Date().toISOString() : null);
  }

  searchMemories(topicId: TopicId, query: string): Array<{ id: string; content: string; sourceRef: string }> {
    return this.db.prepare("SELECT id, content, source_ref AS sourceRef FROM memories WHERE topic_id = ? AND deleted_at IS NULL AND content LIKE ? ORDER BY confirmed_at DESC LIMIT 10").all(topicId, `%${query}%`) as Array<{ id: string; content: string; sourceRef: string }>;
  }

  memoryCount(topicId: TopicId): number {
    return (this.db.prepare("SELECT count(*) AS count FROM memories WHERE topic_id = ? AND deleted_at IS NULL").get(topicId) as { count: number }).count;
  }

  async backup(destination: string): Promise<void> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await this.db.backup(destination);
  }

  searchAllMemories(query: string): Array<{ id: string; topicId: TopicId; content: string; sourceRef: string }> {
    return this.db.prepare("SELECT id, topic_id AS topicId, content, source_ref AS sourceRef FROM memories WHERE deleted_at IS NULL AND content LIKE ? ORDER BY confirmed_at DESC LIMIT 20").all(`%${query}%`) as Array<{ id: string; topicId: TopicId; content: string; sourceRef: string }>;
  }

  deleteMemory(topicId: TopicId, id: string): boolean {
    return this.db.prepare("UPDATE memories SET deleted_at = ? WHERE id = ? AND topic_id = ? AND deleted_at IS NULL").run(new Date().toISOString(), id, topicId).changes > 0;
  }

  close(): void { this.db.close(); }
}
