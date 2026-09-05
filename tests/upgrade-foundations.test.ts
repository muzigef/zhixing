import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { PathPolicy } from "../src/paths.js";
import { importStagedDocument } from "../src/import-command.js";
import { LocalSyncServer } from "../src/sync-server.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { HashEmbeddingModel } from "../src/embedding.js";

const roots: string[] = [];
const databases: ZhixingDatabase[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-upgrade-"));
  roots.push(root);
  const db = new ZhixingDatabase(path.join(root, "zhixing/db/zhixing.sqlite"));
  databases.push(db);
  await fs.mkdir(path.join(root, "zhixing/inbox/rag"), { recursive: true });
  return { root, db, paths: new PathPolicy(root) };
}
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("agent upgrade foundations", () => {
  it("preserves every character of long material sections and bounds each chunk", async () => {
    const { root, db, paths } = await fixture();
    const content = `# 保真\n\n${"很长的段落😀".repeat(400)}\n\n最后的关键证据`;
    const file = path.join(root, "zhixing/inbox/rag/long.md");
    await fs.writeFile(file, content);
    await importStagedDocument(root, new DocumentLibrary(db, paths), "rag/long.md");
    const rows = db.db.prepare("SELECT text FROM chunks ORDER BY rowid").all() as { text: string }[];
    expect(rows.map((row) => row.text).join("")).toBe(content);
    expect(rows.every((row) => row.text.length <= 1000)).toBe(true);
    expect(rows.every((row) => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(row.text))).toBe(true);
  });
  it("cancels through the staged importer without leaving an indexed document and allows retry", async () => {
    const { root, db, paths } = await fixture();
    await fs.writeFile(path.join(root, "zhixing/inbox/rag/cancel.md"), "# 可重试\n资料");
    const controller = new AbortController(); controller.abort();
    await expect(importStagedDocument(root, new DocumentLibrary(db, paths), "rag/cancel.md", controller.signal)).rejects.toThrow();
    expect(db.listDocuments("rag")).toHaveLength(0);
    expect(await importStagedDocument(root, new DocumentLibrary(db, paths), "rag/cancel.md")).toMatchObject({ status: "indexed" });
  });
  it("accepts a registered digit-leading topic and rejects malformed routes", async () => {
    const server = new LocalSyncServer(async (topicId) => ({ topicId }), ["3dgs"]);
    const port = await server.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/topics/3dgs/progress`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ topicId: "3dgs" });
      expect((await fetch(`http://127.0.0.1:${port}/topics/${"a".repeat(200)}/progress`)).status).toBe(404);
    } finally { await server.close(); }
  });
  it("interrupts an OCR wait through the importer deadline and retries the same content", async () => {
    const { root, db, paths } = await fixture();
    await fs.copyFile(path.join(import.meta.dirname, "fixtures/documents/scanned.pdf"), path.join(root, "zhixing/inbox/rag/scan.pdf"));
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const library = new DocumentLibrary(db, paths, {}, new HashEmbeddingModel(), { extract: async () => { entered(); return new Promise(() => undefined); } });
    const pending = importStagedDocument(root, library, "rag/scan.pdf", controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await started; controller.abort(); await rejected;
    expect(db.listDocuments("rag")).toHaveLength(0);
    const retry = new DocumentLibrary(db, paths, {}, new HashEmbeddingModel(), { extract: async () => [{ page: 1, text: "重试后的资料", confidence: 100 }] });
    expect(await importStagedDocument(root, retry, "rag/scan.pdf")).toMatchObject({ status: "indexed", chunks: 1 });
  });
  it("retains the original goal after an oversized recent answer without sending unbounded history", async () => {
    const { root } = await fixture();
    const store = new DesktopStore(path.join(root, "desktop"));
    const session = await store.create();
    const now = new Date().toISOString();
    session.messages.push(
      { id: crypto.randomUUID(), role: "user", text: "目标：用一个贯穿例子理解梯度；请使用中文", status: "completed", createdAt: now },
      { id: crypto.randomUUID(), role: "assistant", text: "长回答".repeat(18_000), status: "completed", createdAt: now },
    );
    await store.save(session);
    let prompt = "";
    const service = new DesktopService(store, () => ({ async *stream(input) { prompt = input; yield { type: "text_delta", text: "继续讲解" }; yield { type: "done" }; } }));
    await service.send({ sessionId: session.id, text: "继续", provider: "demo", style: "adaptive" });
    await service.idle();
    expect(prompt).toContain("目标：用一个贯穿例子理解梯度");
    expect(prompt.length).toBeLessThan(60_000);
    expect((await store.load(session.id)).messages[1]?.text.length).toBe(54_000);
  });
});
