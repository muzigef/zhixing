import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { PathPolicy } from "../src/paths.js";
import { HashEmbeddingModel } from "../src/embedding.js";
import type { OcrEngine } from "../src/ocr.js";
import { textPagesPdf } from "./helpers/pdf-fixture.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
async function fixture(ocr: OcrEngine, limits: { maxTopicBytes?: number } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-page-ocr-"));
  const db = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  cleanup.push(async () => { db.close(); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, "mixed.pdf"); await fs.writeFile(file, textPagesPdf(["Original cache text", "", "Original evidence conclusion"]));
  return { db, file, library: new DocumentLibrary(db, new PathPolicy(root), limits, new HashEmbeddingModel(), ocr) };
}
it("OCRs only empty pages in mixed PDFs and retains original text, page identity and confidence", async () => {
  const extract = vi.fn(async () => [{ page: 2, text: "Scanned cache condition", confidence: 53 }]);
  const { db, file, library } = await fixture({ extract });
  const result = await library.importFile("rag", file);
  expect(extract.mock.calls[0]).toEqual([expect.any(String), expect.any(AbortSignal), { pages: [2] }]);
  expect(result).toMatchObject({ status: "ocr_low_confidence", chunks: 3, extraction: { totalPages: 3, ocrPages: [2], unreadPages: [], lowConfidencePages: [2] } });
  const evidence = library.search("rag", "Scanned condition")[0]!;
  expect(evidence.citation).toMatchObject({ pageNumber: 2, extraction: { method: "ocr", confidence: 53, incompleteDocument: false } });
  expect(library.search("rag", "Original").map(item => item.citation.pageNumber).sort()).toEqual([1, 3]);
  expect(db.documentExtraction("tool-calling", result.documentId)).toBeUndefined();
});
it("reports partial coverage durably, preserves searchable text and retries without duplicate chunks", async () => {
  let ready = false;
  const { db, file, library } = await fixture({ extract: async () => ready ? [{ page: 2, text: "Restored scanned condition", confidence: 95 }] : [] });
  const first = await library.importFile("rag", file);
  expect(first).toMatchObject({ status: "ocr_partial", chunks: 2, extraction: { unreadPages: [2] } });
  expect(library.search("rag", "Original")[0]!.citation.extraction).toMatchObject({ method: "text", incompleteDocument: true });
  expect(db.documentExtraction("rag", first.documentId)?.unreadPages).toEqual([2]);
  ready = true; const second = await library.importFile("rag", file);
  expect(second).toMatchObject({ status: "indexed", documentId: first.documentId, chunks: 3, extraction: { unreadPages: [] } });
  expect(db.documentImpact("rag", first.documentId)?.chunks).toBe(3);
  expect(library.search("rag", "scanned")).toHaveLength(1);
  expect(await library.importFile("rag", file)).toMatchObject({ status: "duplicate" });
});
it("preserves partial records on retry cancellation and refuses malformed OCR page identities", async () => {
  let mode = "malformed"; const abort = new AbortController();
  const { db, file, library } = await fixture({ extract: async () => { if (mode === "cancel") { abort.abort(); abort.signal.throwIfAborted(); } return [{ page: 1, text: "Must not replace original", confidence: 100 }, { page: 2, text: "Invalid confidence", confidence: Number.NaN }]; } });
  const first = await library.importFile("rag", file);
  expect(first.status).toBe("ocr_partial"); expect(library.search("rag", "Invalid")).toEqual([]);
  mode = "cancel"; expect(await library.importFile("rag", file, abort.signal)).toMatchObject({ status: "rejected", reason: "cancelled" });
  expect(db.documentImpact("rag", first.documentId)?.chunks).toBe(2);
  expect(library.search("rag", "Original")).toHaveLength(2);
});
it("retries an existing partial document without charging its stored bytes twice", async () => {
  let ready = false; const limits = { maxTopicBytes: 0 };
  const { file, library } = await fixture({ extract: async () => ready ? [{ page: 2, text: "Scanned condition", confidence: 99 }] : [] }, limits);
  limits.maxTopicBytes = (await fs.stat(file)).size;
  expect((await library.importFile("rag", file)).status).toBe("ocr_partial");
  ready = true; expect((await library.importFile("rag", file)).status).toBe("indexed");
});
it("rolls back replacement chunks and extraction coverage together if retry persistence fails", async () => {
  let ready = false;
  const { db, file, library } = await fixture({ extract: async () => ready ? [{ page: 2, text: "Scanned condition", confidence: 99 }] : [] });
  const first = await library.importFile("rag", file); ready = true;
  vi.spyOn(db, "addChunk").mockImplementationOnce(() => { throw new Error("synthetic_write_failure"); });
  await expect(library.importFile("rag", file)).rejects.toThrow("synthetic_write_failure");
  expect(db.documentImpact("rag", first.documentId)?.chunks).toBe(2);
  expect(db.documentExtraction("rag", first.documentId)?.unreadPages).toEqual([2]);
  const reopened = new ZhixingDatabase(db.file);
  try { expect(reopened.documentExtraction("rag", first.documentId)?.unreadPages).toEqual([2]); }
  finally { reopened.close(); }
});
it("keeps previously recognized scan pages when only the remaining page fails on retry", async () => {
  let attempt = 0;
  const extract = vi.fn(async () => ++attempt === 1 ? [{ page: 2, text: "Retained scanned condition", confidence: 92 }] : []);
  const { file, library } = await fixture({ extract });
  await fs.writeFile(file, textPagesPdf(["Original cache text", "", ""]));
  expect(await library.importFile("rag", file)).toMatchObject({ status: "ocr_partial", chunks: 2, extraction: { unreadPages: [3] } });
  expect(await library.importFile("rag", file)).toMatchObject({ status: "ocr_partial", chunks: 2, extraction: { ocrPages: [2], unreadPages: [3] } });
  expect(extract.mock.calls[1]).toEqual([expect.any(String), expect.any(AbortSignal), { pages: [3] }]);
  expect(library.search("rag", "Retained")[0]?.citation).toMatchObject({ pageNumber: 2, extraction: { method: "ocr", confidence: 92 } });
});
it("re-extracts old OCR text after the document extraction recipe changes", async () => {
  let text = "Old scanned content"; const extract = vi.fn(async () => [{ page: 2, text, confidence: 95 }]);
  const { db, file, library } = await fixture({ extract }); await library.importFile("rag", file);
  db.db.prepare("UPDATE document_indexes SET recipe='legacy-extraction'").run(); text = "Fresh scanned content";
  await library.importFile("rag", file); expect(extract).toHaveBeenCalledTimes(2);
  expect(library.search("rag", "Fresh")[0]?.text).toContain("Fresh"); expect(library.search("rag", "Old")).toEqual([]);
});
