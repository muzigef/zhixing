import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { PathPolicy } from "../src/paths.js";
import { createDefaultTopicRegistry } from "../src/topics.js";
import { importStagedDocument } from "../src/import-command.js";

const roots: string[] = [];
async function fixture(): Promise<{ root: string; db: ZhixingDatabase; library: DocumentLibrary }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-"));
  roots.push(root);
  const db = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  return { root, db, library: new DocumentLibrary(db, new PathPolicy(root)) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("主题隔离与本地资料库", () => {
  it("注册四个首批主题并拒绝路径逃逸", () => {
    const registry = createDefaultTopicRegistry();
    expect(registry.list()).toHaveLength(4);
    expect(() => new PathPolicy("/safe").resolveTopicPath("rag", "library", "..", "secret")).toThrow("denied");
  });

  it("导入 Markdown 后只在当前主题检索并提供引用", async () => {
    const { root, db, library } = await fixture();
    const source = path.join(root, "rag.md");
    await fs.writeFile(source, "# 检索\n\nRAG 使用检索结果为回答提供证据。", "utf8");
    const imported = await library.importFile("rag", source);
    expect(imported.status).toBe("indexed");
    const hits = library.search("rag", "RAG");
    expect(hits[0]?.citation.documentName).toBe("rag.md");
    expect(library.search("tool-calling", "RAG")).toEqual([]);
    expect(library.list("rag")).toEqual([expect.objectContaining({ name: "rag.md", status: "indexed" })]);
    expect(library.list("tool-calling")).toEqual([]);
    db.close();
  });

  it("准备的文字与扫描 PDF fixture 分别建立索引或要求 OCR", async () => {
    const { db, library } = await fixture();
    const fixtureDir = path.join(import.meta.dirname, "fixtures", "documents");
    const text = await library.importFile("rag", path.join(fixtureDir, "text.pdf"));
    const scanned = await library.importFile("rag", path.join(fixtureDir, "scanned.pdf"));
    expect(text.status).toBe("indexed");
    expect(text.chunks).toBeGreaterThan(0);
    expect(library.search("rag", "RAG")[0]?.citation.pageNumber).toBe(1);
    expect(["indexed", "ocr_low_confidence", "ocr_required"]).toContain(scanned.status);
    const invalid = await library.importFile("rag", path.join(fixtureDir, "invalid.pdf"));
    expect(invalid).toMatchObject({ status: "parse_failed", reason: "parse_failed", chunks: 0 });
    const tooManyPages = await library.importFile("rag", path.join(fixtureDir, "many-pages.pdf"));
    expect(tooManyPages).toMatchObject({ status: "rejected", reason: "page_limit_exceeded", chunks: 0 });
    const encrypted = await library.importFile("rag", path.join(fixtureDir, "encrypted.pdf"));
    expect(encrypted).toMatchObject({ status: "parse_failed", reason: "encrypted_pdf", chunks: 0 });
    db.close();
  });

  it("取消导入返回稳定状态且不留下 Chunk", async () => {
    const { db, library } = await fixture();
    const controller = new AbortController();
    controller.abort();
    const sourceFile = path.join(import.meta.dirname, "fixtures", "documents", "notes.md");
    await expect(library.importFile("rag", sourceFile, controller.signal)).resolves.toMatchObject({ status: "rejected", reason: "cancelled", chunks: 0 });
    expect((db.db.prepare("SELECT count(*) AS count FROM chunks").get() as { count: number }).count).toBe(0);
    db.close();
  });

  it("资料删除先预览，确认后清理 SQLite、FTS 和本地原文件", async () => {
    const { root, db, library } = await fixture();
    const source = path.join(root, "deletable.md");
    await fs.writeFile(source, "# 可删除\n\n资料删除必须清理索引。", "utf8");
    const imported = await library.importFile("rag", source);
    const impact = library.previewDeletion("rag", imported.documentId);
    expect(impact?.chunks).toBeGreaterThan(0);
    await expect(library.deleteDocument("rag", imported.documentId, false)).rejects.toThrow("confirmation_required");
    await expect(library.deleteDocument("rag", imported.documentId, true)).resolves.toMatchObject({ chunks: impact?.chunks });
    expect(library.search("rag", "删除")).toEqual([]);
    expect((db.db.prepare("SELECT count(*) AS count FROM citations WHERE document_id = ?").get(imported.documentId) as { count: number }).count).toBe(0);
    await expect(fs.access(path.join(root, "zhixing", "data", "library", "rag", imported.documentId))).rejects.toThrow();
    const backup = path.join(root, "backup.sqlite");
    await db.backup(backup);
    expect((await fs.stat(backup)).size).toBeGreaterThan(0);
    db.close();
  });

  it("拒绝未经确认的用户长期记忆并支持软删除", async () => {
    const { db } = await fixture();
    expect(() => db.writeMemory("m1", { topicId: "rag", type: "learning_fact", content: "FTS5", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: false })).toThrow("确认");
    db.writeMemory("m2", { topicId: "rag", type: "learning_fact", content: "FTS5 用于关键词检索", sourceKind: "review", sourceRef: "review:D01", confidence: 1, confirmed: true });
    expect(db.searchMemories("rag", "FTS5")).toHaveLength(1);
    db.writeMemory("m3", { topicId: "tool-calling", type: "learning_fact", content: "FTS5 与工具", sourceKind: "review", sourceRef: "review:D01", confidence: 1, confirmed: true });
    expect(db.searchAllMemories("FTS5").map((memory) => memory.topicId)).toEqual(expect.arrayContaining(["rag", "tool-calling"]));
    expect(db.deleteMemory("rag", "m2")).toBe(true);
    expect(db.searchMemories("rag", "FTS5")).toEqual([]);
    db.close();
  });

  it("只导入 inbox/<topicId> 下的暂存资料", async () => {
    const { root, db, library } = await fixture();
    const staged = path.join(root, "zhixing", "inbox", "rag");
    await fs.mkdir(staged, { recursive: true });
    await fs.writeFile(path.join(staged, "source.md"), "# 资料\n\n本地导入", "utf8");
    const result = await importStagedDocument(root, library, "rag/source.md");
    expect(result.topicId).toBe("rag");
    expect(result.status).toBe("indexed");
    await expect(importStagedDocument(root, library, "../outside.md")).rejects.toThrow("denied");
    const outside = path.join(root, "outside.md");
    await fs.writeFile(outside, "outside", "utf8");
    await fs.symlink(outside, path.join(staged, "outside-link.md"));
    await expect(importStagedDocument(root, library, "rag/outside-link.md")).rejects.toThrow("符号链接越界");
    const tooLarge = path.join(staged, "large.md");
    await fs.writeFile(tooLarge, "x");
    await fs.truncate(tooLarge, 250 * 1024 * 1024 + 1);
    await expect(importStagedDocument(root, library, "rag/large.md")).rejects.toThrow("file_too_large");
    db.close();
  });

  it("同一主题相同哈希去重", async () => {
    const { root, db, library } = await fixture();
    const source = path.join(root, "note.md");
    await fs.writeFile(source, "# 标题\n\n唯一资料", "utf8");
    const first = await library.importFile("rag", source);
    const second = await library.importFile("rag", source);
    expect(first.status).toBe("indexed");
    expect(second.status).toBe("duplicate");
    expect(second.documentId).toBe(first.documentId);
    expect(crypto.createHash("sha256").update("x").digest("hex")).toHaveLength(64);
    db.close();
  });

  it("E27：主题资料配额拒绝不产生残留文档或 Chunk", async () => {
    const { root, db } = await fixture();
    const source = path.join(root, "quota.md");
    await fs.writeFile(source, "# 配额\n\n内容", "utf8");
    const library = new DocumentLibrary(db, new PathPolicy(root), { maxTopicBytes: 1 });
    await expect(library.importFile("rag", source)).resolves.toMatchObject({ status: "rejected", reason: "topic_quota_exceeded", chunks: 0 });
    expect(library.list("rag")).toEqual([]);
    db.close();
  });
});
