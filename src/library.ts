import { DOCUMENT_INDEX_RECIPE } from "./document-index-recipe.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ZhixingDatabase } from "./database.js";
import { PathPolicy } from "./paths.js";
import type { SearchResult, TopicId } from "./contracts.js";
import { HashEmbeddingModel, type EmbeddingModel } from "./embedding.js";
import { TesseractOcrEngine, type OcrEngine } from "./ocr.js";
import { chunkDocumentParts, relatedPartIndexes, splitMarkdownSections } from "./document-chunking.js";
import { extractionCoverage, ocrResultSchema, type PageExtraction } from "./document-extraction.js";
import { abortable } from "./abortable.js";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { expandQuery, rankEvidence } from "./retrieval-query.js";

// 250 MB accommodates the approved local PDF exception while keeping import memory bounded.
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const MAX_TOPIC_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

export type ImportResult = {
  status: "indexed" | "ocr_low_confidence" | "ocr_partial" | "duplicate" | "ocr_required" | "parse_failed" | "rejected";
  documentId: string;
  chunks: number;
  extraction?: ReturnType<typeof extractionCoverage>;
  reason?: "file_too_large" | "topic_quota_exceeded" | "unsupported_mime" | "page_limit_exceeded" | "encrypted_pdf" | "parse_failed" | "cancelled";
};

class ImportRejectedError extends Error {}

/** Local document importer. Extracted source text is data, never executable instruction. */
export class DocumentLibrary {
  constructor(private readonly database: ZhixingDatabase, private readonly paths: PathPolicy, private readonly limits: { maxTopicBytes?: number } = {}, private readonly embedding: EmbeddingModel = new HashEmbeddingModel(), private readonly ocr: OcrEngine = new TesseractOcrEngine()) {}

  async importFile(topicId: TopicId, inputFile: string, signal?: AbortSignal): Promise<ImportResult> {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    if (signal.aborted) return { status: "rejected", documentId: "", chunks: 0, reason: "cancelled" };
    let source: Buffer;
    try { source = await fs.readFile(inputFile, { signal }); }
    catch (error) {
      if (isAbort(error, signal)) return { status: "rejected", documentId: "", chunks: 0, reason: "cancelled" };
      throw error;
    }
    if (source.byteLength > MAX_FILE_BYTES) return { status: "rejected", documentId: "", chunks: 0, reason: "file_too_large" };
    const ext = path.extname(inputFile).toLowerCase();
    if (ext !== ".md" && ext !== ".markdown" && ext !== ".pdf") return { status: "rejected", documentId: "", chunks: 0, reason: "unsupported_mime" };
    const sha256 = crypto.createHash("sha256").update(source).digest("hex");
    const existing = this.database.findDocument(topicId, sha256);
    if (existing && ["indexed", "ocr_low_confidence"].includes(existing.status) && this.database.documentIndexVersion(topicId, existing.id) === DOCUMENT_INDEX_RECIPE) return { status: "duplicate", documentId: existing.id, chunks: 0 };

    const documentId = existing?.id ?? crypto.randomUUID();
    const name = existing ? this.database.listDocuments(topicId).find((item) => item.id === existing.id)!.name : path.basename(inputFile);
    const destination = this.paths.resolveTopicPath(topicId, "library", documentId, name);
    await this.paths.assertNoSymlink(topicId, "library");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await this.paths.assertNoSymlink(topicId, "library");
    let replacedBytes = 0;
    if (existing) try { const prior = await fs.lstat(destination); if (prior.isFile()) replacedBytes = prior.size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (source.byteLength + await directoryBytes(this.paths.topicDir(topicId, "library")) - replacedBytes > (this.limits.maxTopicBytes ?? MAX_TOPIC_BYTES)) {
      if (!existing) await fs.rm(path.dirname(destination), { recursive: true, force: true });
      return { status: "rejected", documentId: "", chunks: 0, reason: "topic_quota_exceeded" };
    }
    // Copy the exact bytes that were hashed, even if the staged file changes meanwhile.
    const recordStatus = (status: string) => {
      if (existing) this.database.db.prepare("UPDATE documents SET status = ? WHERE id = ? AND topic_id = ?").run(status, documentId, topicId);
      else this.database.addDocument(documentId, topicId, sha256, name, ext === ".pdf" ? "application/pdf" : "text/markdown", status);
    };
    const cancelled = async (): Promise<ImportResult> => {
      if (!existing) await fs.rm(path.dirname(destination), { recursive: true, force: true });
      return { status: "rejected", documentId, chunks: 0, reason: "cancelled" };
    };
    try { await fs.writeFile(destination, source, { signal, mode: 0o600 }); }
    catch (error) { if (isAbort(error, signal)) return cancelled(); throw error; }

    let pages: Array<{ text: string; page: number | null; anchor: string | null }>;
    try {
      if (signal?.aborted) throw new ImportRejectedError("cancelled");
      pages = ext === ".pdf" ? await this.extractPdf(source, signal) : splitMarkdownSections(source.toString("utf8"));
      if (signal?.aborted) throw new ImportRejectedError("cancelled");
    } catch (error) {
      const reason = isAbort(error, signal) || error instanceof ImportRejectedError && error.message === "cancelled" ? "cancelled" : error instanceof ImportRejectedError ? "page_limit_exceeded" : error instanceof Error && /password|encrypted/i.test(error.message) ? "encrypted_pdf" : "parse_failed";
      const status = reason === "page_limit_exceeded" || reason === "cancelled" ? "rejected" : "parse_failed";
      if (reason === "cancelled") return cancelled();
      await fs.rm(path.dirname(destination), { recursive: true, force: true });
      recordStatus(status);
      return { status, documentId, chunks: 0, reason };
    }
    const pageMetadata: PageExtraction[] = ext === ".pdf" ? pages.map(page => ({ page: page.page!, method: page.text.trim() ? "text" : "unread" })) : [];
    if (existing && pageMetadata.length && this.database.documentIndexVersion(topicId, documentId) === DOCUMENT_INDEX_RECIPE) {
      const previous = this.database.documentExtraction(topicId, documentId);
      for (const page of previous?.pages ?? []) {
        if (page.method !== "ocr" || pageMetadata[page.page - 1]?.method !== "unread") continue;
        const chunks = this.database.db.prepare("SELECT text FROM chunks WHERE topic_id=? AND document_id=? AND page_number=? ORDER BY rowid").all(topicId, documentId, page.page) as { text: string }[];
        const text = chunks.map(chunk => chunk.text).join("");
        if (!text.trim()) continue;
        pages[page.page - 1] = { text, page: page.page, anchor: null };
        pageMetadata[page.page - 1] = page;
      }
    }
    const missing = pageMetadata.filter(page => page.method === "unread").map(page => page.page);
    if (missing.length) {
      try {
        const recognized = ocrResultSchema.parse(await abortable(() => this.ocr.extract(destination, signal, { pages: missing }), signal));
        signal.throwIfAborted();
        const requested = new Set(missing);
        if (recognized.some(page => !requested.has(page.page))) throw new Error("ocr_result_invalid");
        for (const page of recognized) {
          if (!page.text.trim()) continue;
          pages[page.page - 1] = { text: page.text, page: page.page, anchor: null };
          pageMetadata[page.page - 1] = { page: page.page, method: "ocr", confidence: page.confidence };
        }
      } catch (error) {
        if (isAbort(error, signal)) return cancelled();
        // Failed/invalid OCR never replaces extracted text or silently claims full coverage.
      }
    }
    const extraction = pageMetadata.length ? extractionCoverage(pageMetadata) : undefined;
    if (!pages.some((page) => page.text.trim())) {
      this.database.db.transaction(() => { recordStatus("ocr_required"); this.database.replaceDocumentPages(documentId, pageMetadata); })();
      return { status: "ocr_required", documentId, chunks: 0, extraction };
    }
    const indexedStatus = extraction?.unreadPages.length ? "ocr_partial" : extraction?.lowConfidencePages.length ? "ocr_low_confidence" : "indexed";

    // Expensive preparation yields to cancellation before opening the atomic write transaction.
    const prepared: { id: string; text: string; page: number | null; anchor: string | null; vector: readonly number[]; contextIds: string[] }[] = [];
    try {
      for (const page of pages) {
        const parts = chunkDocumentParts(page.text); const ids = parts.map(() => crypto.randomUUID());
        for (const [index, part] of parts.entries()) {
          if (prepared.length % 25 === 0) await yieldToLoop();
          signal.throwIfAborted();
          const contextIds = relatedPartIndexes(parts, part).map(position => ids[position]!);
          prepared.push({ id: ids[index]!, text: part.text, page: page.page, anchor: page.anchor, vector: this.embedding.embed(part.text), contextIds });
        }
      }
      signal?.throwIfAborted();
    } catch (error) { if (isAbort(error, signal)) return cancelled(); throw error; }
    this.database.db.exec("BEGIN IMMEDIATE");
    try {
      const committed = this.database.findDocument(topicId, sha256);
      if (committed && (committed.id !== documentId || ["indexed", "ocr_low_confidence"].includes(committed.status) && this.database.documentIndexVersion(topicId, committed.id) === DOCUMENT_INDEX_RECIPE)) {
        this.database.db.exec("COMMIT");
        if (!existing) await fs.rm(path.dirname(destination), { recursive: true, force: true });
        return { status: "duplicate", documentId: committed.id, chunks: 0 };
      }
      recordStatus(indexedStatus);
      if (existing) this.database.clearDocumentChunks(topicId, documentId);
      this.database.replaceDocumentPages(documentId, pageMetadata);
      let count = 0;
      for (const chunk of prepared) {
        if (signal?.aborted) throw new ImportRejectedError("cancelled");
        const chunkId = chunk.id;
        this.database.addChunk(chunkId, topicId, documentId, chunk.text, chunk.page, chunk.anchor, crypto.createHash("sha256").update(chunk.text).digest("hex"));
        this.database.addEmbedding(chunkId, topicId, chunk.vector);
        count += 1;
      }
      const relation = this.database.db.prepare("INSERT INTO chunk_context(chunk_id,context_id) VALUES (?,?)");
      for (const chunk of prepared) for (const contextId of chunk.contextIds) relation.run(chunk.id, contextId);
      this.database.db.prepare("INSERT OR REPLACE INTO document_indexes(document_id,recipe) VALUES (?,?)").run(documentId, DOCUMENT_INDEX_RECIPE);
      this.database.db.exec("COMMIT");
      return { status: indexedStatus, documentId, chunks: count, extraction };
    } catch (error) {
      if (this.database.db.inTransaction) this.database.db.exec("ROLLBACK");
      if (isAbort(error, signal) || error instanceof ImportRejectedError && error.message === "cancelled") {
        return cancelled();
      }
      throw error;
    }
  }

  search(topicId: TopicId, query: string): SearchResult[] {
    const terms = expandQuery(query);
    return this.database.withChunkContext(rankEvidence(this.database.retrievalCandidates(topicId, terms), terms));
  }

  list(topicId: TopicId): Array<{ id: string; name: string; status: string; createdAt: string }> { return this.database.listDocuments(topicId); }

  previewDeletion(topicId: TopicId, documentId: string): { documentId: string; name: string; chunks: number } | undefined {
    return this.database.documentImpact(topicId, documentId);
  }

  async deleteDocument(topicId: TopicId, documentId: string, confirmed: boolean): Promise<{ name: string; chunks: number }> {
    if (!confirmed) throw new Error("confirmation_required: 请先使用资料删除预览，再以 --确认 执行删除。");
    const impact = this.database.documentImpact(topicId, documentId);
    if (!impact) throw new Error("document_not_found");
    const directory = this.paths.resolveTopicPath(topicId, "library", documentId);
    await this.paths.assertNoSymlink(topicId, "library");
    const temporary = `${directory}.deleting`;
    try {
      await fs.rename(directory, temporary);
      const deleted = this.database.deleteDocument(topicId, documentId);
      if (!deleted) throw new Error("document_not_found");
      await fs.rm(temporary, { recursive: true, force: true });
      return deleted;
    } catch (error) {
      try { await fs.rename(temporary, directory); } catch { /* no source directory to restore */ }
      throw error;
    }
  }

  private async extractPdf(source: Buffer, signal?: AbortSignal): Promise<Array<{ text: string; page: number; anchor: null }>> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // System fonts avoid browser-only file URL loading for standard PDF fonts in Node.
    const task = pdfjs.getDocument({ data: new Uint8Array(source), useSystemFonts: true, verbosity: 0 });
    const destroy = () => { void task.destroy().catch(() => undefined); };
    signal?.addEventListener("abort", destroy, { once: true });
    try {
      const document = signal ? await abortable(() => task.promise, signal) : await task.promise;
      if (document.numPages > MAX_PDF_PAGES) throw new ImportRejectedError("page_limit_exceeded");
      const pages: Array<{ text: string; page: number; anchor: null }> = [];
      for (let page = 1; page <= document.numPages; page += 1) {
        signal?.throwIfAborted();
        const getContent = async () => (await document.getPage(page)).getTextContent();
        const content = signal ? await abortable(getContent, signal) : await getContent();
        pages.push({ text: content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""), page, anchor: null });
      }
      return pages;
    } finally { signal?.removeEventListener("abort", destroy); await task.destroy(); }
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || error instanceof Error && error.name === "AbortError";
}

async function directoryBytes(directory: string): Promise<number> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? directoryBytes(file) : entry.isFile() ? (await fs.stat(file)).size : 0;
    }))).reduce((total, size) => total + size, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
