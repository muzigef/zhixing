import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type { MemoryInput, SearchResult, TopicId } from "./contracts.js";
import { cosineSimilarity } from "./embedding.js";
import { withSourceVersion } from "./source-version.js";
import { expandQuery } from "./retrieval-query.js";
import { memoryCorrectionSchema, memoryContentHash, type MemoryCorrection } from "./memory-correction.js";
import { extractionCoverage, pageExtractionSchema, type PageExtraction } from "./document-extraction.js";
export const DATABASE_SCHEMA_VERSION = 9;
interface RetrievalRow { chunkId: string; text: string; documentId: string; documentName: string; pageNumber: number | null; anchor: string | null; }
function retrievalResult(topicId: string, row: RetrievalRow): SearchResult { return withSourceVersion({ text: row.text, score: 0, citation: { topicId, chunkId: row.chunkId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, anchor: row.anchor } }); }

export class ZhixingDatabase {
  readonly db: Database.Database;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    try {
      const hasVersions = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
      const version = hasVersions ? (this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version : 0;
      if (version > DATABASE_SCHEMA_VERSION) throw new Error("storage_version_unsupported");
    } catch (error) { this.db.close(); throw error; }
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
      CREATE TABLE IF NOT EXISTS document_indexes (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, recipe TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunk_context (
        chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        context_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, PRIMARY KEY(chunk_id, context_id)
      );
      CREATE TABLE IF NOT EXISTS document_pages (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page INTEGER NOT NULL,
        method TEXT NOT NULL, confidence REAL, PRIMARY KEY(document_id, page)
      );
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
      CREATE TABLE IF NOT EXISTS memory_corrections (
        previous_id TEXT PRIMARY KEY REFERENCES memories(id), replacement_id TEXT NOT NULL UNIQUE REFERENCES memories(id),
        source_hash TEXT NOT NULL, confirmed_at TEXT NOT NULL
      );
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
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(4, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(5, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(6, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(7, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(8, new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(9, new Date().toISOString());
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

  replaceDocumentPages(documentId: string, pages: PageExtraction[]): void {
    if (!this.db.inTransaction) throw new Error("document_transaction_required");
    const checked = pageExtractionSchema.array().max(500).parse(pages);
    this.db.prepare("DELETE FROM document_pages WHERE document_id=?").run(documentId);
    const insert = this.db.prepare("INSERT INTO document_pages(document_id,page,method,confidence) VALUES (?,?,?,?)");
    for (const page of checked) insert.run(documentId, page.page, page.method, page.confidence ?? null);
  }
  documentExtraction(topicId: string, documentId: string) {
    const rows = this.db.prepare("SELECT p.page,p.method,p.confidence FROM document_pages p JOIN documents d ON d.id=p.document_id WHERE d.topic_id=? AND d.id=? ORDER BY p.page").all(topicId, documentId) as (Omit<PageExtraction, "confidence"> & { confidence: number | null })[];
    if (!rows.length) return;
    const pages = rows.map(row => pageExtractionSchema.parse({ page: row.page, method: row.method, ...(row.confidence === null ? {} : { confidence: row.confidence }) }));
    return { ...extractionCoverage(pages), pages };
  }
  withExtraction(items: SearchResult[]): SearchResult[] {
    const receipts = new Map<string, ReturnType<ZhixingDatabase["documentExtraction"]>>();
    return items.map(item => {
      const key = JSON.stringify([item.citation.topicId, item.citation.documentId]);
      if (!receipts.has(key)) receipts.set(key, this.documentExtraction(item.citation.topicId, item.citation.documentId));
      const receipt = receipts.get(key); const page = receipt?.pages.find(p => p.page === item.citation.pageNumber);
      const citation = { ...item.citation }; delete citation.extraction;
      if (!page || page.method === "unread") return { ...item, citation };
      return { ...item, citation: { ...citation, extraction: { method: page.method, ...(page.confidence === undefined ? {} : { confidence: page.confidence }), incompleteDocument: Boolean(receipt?.unreadPages.length) } } };
    });
  }
  clearDocumentChunks(topicId: string, documentId: string): void {
    if (!this.db.inTransaction) throw new Error("document_transaction_required");
    this.db.prepare("DELETE FROM chunks_fts WHERE topic_id=? AND chunk_id IN (SELECT id FROM chunks WHERE document_id=?)").run(topicId, documentId);
    this.db.prepare("DELETE FROM chunks WHERE topic_id=? AND document_id=?").run(topicId, documentId);
  }
  documentIndexVersion(topicId: string, documentId: string): string | undefined {
    return (this.db.prepare("SELECT i.recipe FROM document_indexes i JOIN documents d ON d.id=i.document_id WHERE d.topic_id=? AND d.id=?").get(topicId, documentId) as { recipe: string } | undefined)?.recipe;
  }
  withChunkContext(items: SearchResult[], limit = 8): SearchResult[] {
    const result: SearchResult[] = []; const seen = new Set<string>();
    const add = (item: SearchResult) => { const key = JSON.stringify([item.citation.documentId, item.citation.chunkId]); if (result.length < limit && !seen.has(key)) { result.push(item); seen.add(key); } };
    for (const item of items) {
      if (result.length >= limit) break;
      add(item);
      if (!item.citation.chunkId) continue;
      const rows = this.db.prepare(`SELECT c.id AS chunkId,c.text,d.id AS documentId,d.name AS documentName,c.page_number AS pageNumber,c.anchor
        FROM chunk_context x JOIN chunks c ON c.id=x.context_id JOIN documents d ON d.id=c.document_id
        WHERE x.chunk_id=? AND c.topic_id=? AND c.document_id=? ORDER BY c.rowid LIMIT 2`).all(item.citation.chunkId, item.citation.topicId, item.citation.documentId) as RetrievalRow[];
      for (const row of rows) add(retrievalResult(item.citation.topicId, row));
    }
    return this.withExtraction(result);
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
    const rows = this.db.prepare(`SELECT c.id AS chunkId, c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor, bm25(chunks_fts) AS score
      FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.chunk_id JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ? AND chunks_fts.topic_id = ? ORDER BY score LIMIT 8`).all(query, topicId) as Array<{ chunkId: string; text: string; documentId: string; documentName: string; pageNumber: number | null; anchor: string | null; score: number }>;
    return this.withExtraction(rows.map((row) => withSourceVersion({ text: row.text, score: row.score, citation: { topicId, chunkId: row.chunkId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, anchor: row.anchor } })));
  }

  hybridSearch(topicId: TopicId, query: string, queryVector: readonly number[]): SearchResult[] {
    const lexical = this.search(topicId, query);
    const lexicalRank = new Map(lexical.map((item, index) => [item.citation.documentId + item.text, 1 / (index + 1)]));
    const rows = this.db.prepare(`SELECT c.id AS chunkId, c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor, e.vector_json AS vectorJson
      FROM chunks c JOIN documents d ON d.id = c.document_id LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
      WHERE c.topic_id = ? AND d.status IN ('indexed', 'ocr_low_confidence', 'ocr_partial')`).all(topicId) as Array<{ chunkId: string; text: string; documentId: string; documentName: string; pageNumber: number | null; anchor: string | null; vectorJson: string | null }>;
    return this.withExtraction(rows.map((row) => {
      const vector = row.vectorJson ? JSON.parse(row.vectorJson) as number[] : [];
      const semantic = Math.max(0, cosineSimilarity(queryVector, vector));
      const lexicalScore = lexicalRank.get(row.documentId + row.text) ?? 0;
      return withSourceVersion({ text: row.text, score: lexicalScore * 0.65 + semantic * 0.35, citation: { topicId, chunkId: row.chunkId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, anchor: row.anchor } });
    }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 8));
  }
  retrievalCandidates(topicId: TopicId, terms: string[]): SearchResult[] {
    if (!terms.length) return [];
    const selected = terms.slice(0, 32);
    const rows = this.db.prepare(`SELECT c.id AS chunkId, c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor
      FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.topic_id=? AND d.status IN ('indexed','ocr_low_confidence','ocr_partial')
      AND (${selected.map(() => "c.text LIKE ? ESCAPE '\\'").join(" OR ")}) ORDER BY c.rowid LIMIT 300`).all(topicId, ...selected.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`)) as RetrievalRow[];
    return this.withExtraction(rows.map((row) => retrievalResult(topicId, row)));
  }
  neighboringChunks(topicId: TopicId, chunkId: string): SearchResult[] {
    const target = this.db.prepare("SELECT rowid, document_id FROM chunks WHERE topic_id=? AND id=?").get(topicId, chunkId) as { rowid: number; document_id: string } | undefined;
    if (!target) return [];
    const rows = ["<", ">"].flatMap((direction) => this.db.prepare(`SELECT c.id AS chunkId, c.text, d.id AS documentId, d.name AS documentName, c.page_number AS pageNumber, c.anchor AS anchor FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.topic_id=? AND c.document_id=? AND c.rowid ${direction} ? ORDER BY c.rowid ${direction === "<" ? "DESC" : "ASC"} LIMIT 1`).all(topicId, target.document_id, target.rowid) as RetrievalRow[]);
    return this.withExtraction(rows.map((row) => retrievalResult(topicId, row)));
  }

  writeMemory(id: string, input: MemoryInput): void {
    if (!input.confirmed && input.sourceKind === "user") throw new Error("denied: 用户记忆需要确认");
    if (input.sourceKind === "document" && !input.sourceRef) throw new Error("denied: 知识记忆必须有引用");
    this.db.prepare("INSERT INTO memories(id, topic_id, memory_type, content, source_kind, source_ref, confidence, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.topicId, input.type, input.content, input.sourceKind, input.sourceRef, input.confidence, input.confirmed ? new Date().toISOString() : null);
  }

  readMemory(topicId: TopicId, id: string) {
    const row = this.db.prepare(`SELECT m.id, m.content, m.memory_type AS type, m.source_ref AS sourceRef, c.replacement_id AS supersededBy
      FROM memories m LEFT JOIN memory_corrections c ON c.previous_id=m.id WHERE m.topic_id=? AND m.id=? AND m.deleted_at IS NULL`).get(topicId, id) as { id: string; content: string; type: MemoryInput["type"]; sourceRef: string; supersededBy: string | null } | undefined;
    return row ? { ...row, contentHash: memoryContentHash(row.content), status: row.supersededBy ? "superseded" as const : "active" as const } : undefined;
  }

  /** A confirmed correction retains the original and never resurrects it if its successor is withdrawn. */
  correctMemory(topicId: TopicId, raw: MemoryCorrection) {
    const input = memoryCorrectionSchema.parse(raw);
    return this.db.transaction(() => {
      const old = this.readMemory(topicId, input.id);
      if (!old) throw new Error("memory_not_found");
      if (old.contentHash !== input.expectedHash) throw new Error("memory_changed");
      const id = `memory-${memoryContentHash(JSON.stringify([topicId, input.id, input.expectedHash, input.content]))}`;
      if (old.supersededBy) {
        if (old.supersededBy !== id || !this.readMemory(topicId, id)) throw new Error("memory_changed");
      } else {
        this.writeMemory(id, { topicId, type: old.type, content: input.content, sourceKind: "user", sourceRef: `user:approved-correction:${old.id}`, confidence: 1, confirmed: true });
        this.db.prepare("INSERT INTO memory_corrections(previous_id,replacement_id,source_hash,confirmed_at) VALUES (?,?,?,?)").run(old.id, id, old.contentHash, new Date().toISOString());
      }
      return { id, contentHash: memoryContentHash(input.content), supersedes: old.id };
    })();
  }

  searchMemories(topicId: TopicId, query: string): Array<{ id: string; content: string; sourceRef: string; contentHash: string }> {
    const normalized = query.trim().slice(0, 400);
    const expanded = expandQuery(normalized);
    const terms = normalized ? (expanded.length ? expanded : [normalized]) : [];
    const patterns = terms.map(term => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
    const match = "content LIKE ? ESCAPE '\\'";
    // Rank in SQL before limiting: unrelated recent records cannot evict older matches.
    const filter = terms.length ? ` AND (${terms.map(() => match).join(" OR ")})` : "";
    const rank = terms.length ? `${terms.map(() => `(CASE WHEN ${match} THEN 1 ELSE 0 END)`).join(" + ")} DESC, ` : "";
    const rows = this.db.prepare(`SELECT id, content, source_ref AS sourceRef FROM memories WHERE topic_id = ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM memory_corrections WHERE previous_id=memories.id)${filter} ORDER BY ${rank}confirmed_at DESC, rowid DESC LIMIT 10`).all(topicId, ...patterns, ...patterns) as Array<{ id: string; content: string; sourceRef: string }>;
    return rows.map(row => ({ ...row, contentHash: memoryContentHash(row.content) }));
  }

  memoryCount(topicId: TopicId): number {
    return (this.db.prepare("SELECT count(*) AS count FROM memories WHERE topic_id = ? AND deleted_at IS NULL").get(topicId) as { count: number }).count;
  }

  async backup(destination: string): Promise<void> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await this.db.backup(destination);
  }

  searchAllMemories(query: string): Array<{ id: string; topicId: TopicId; content: string; sourceRef: string }> {
    return this.db.prepare("SELECT id, topic_id AS topicId, content, source_ref AS sourceRef FROM memories WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM memory_corrections WHERE previous_id=memories.id) AND content LIKE ? ESCAPE '\\' ORDER BY confirmed_at DESC, rowid DESC LIMIT 20").all(`%${query.slice(0, 400).replace(/[\\%_]/g, "\\$&")}%`) as Array<{ id: string; topicId: TopicId; content: string; sourceRef: string }>;
  }

  deleteMemory(topicId: TopicId, id: string): boolean {
    return this.db.prepare("UPDATE memories SET deleted_at = ? WHERE id = ? AND topic_id = ? AND deleted_at IS NULL").run(new Date().toISOString(), id, topicId).changes > 0;
  }

  close(): void { this.db.close(); }
}

/** Read-only preflight also rejects a future schema before restoring data. */
/** Validate standalone snapshot bytes, never SQLite sidecars beside a user backup. */
export function inspectDatabaseSnapshot(file: string): void {
  const source = fs.lstatSync(file);
  if (!source.isFile() || source.isSymbolicLink() || source.nlink !== 1) throw new Error("backup_link_denied");
  if (source.size > 2_000_000_000) throw new Error("backup_size_limit");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhixing-snapshot-check-"));
  let db: Database.Database | undefined;
  try {
    const copy = path.join(directory, "snapshot.sqlite"); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); fs.chmodSync(copy, 0o600);
    db = new Database(copy, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
    if (!Number.isInteger(row.version) || row.version < 1) throw new Error("backup_integrity_failed");
    if (row.version > DATABASE_SCHEMA_VERSION) throw new Error("storage_version_unsupported");
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("backup_integrity_failed");
  } finally { try { db?.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); } }
}
