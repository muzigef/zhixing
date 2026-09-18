import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { SemanticIndex } from "../src/semantic-retrieval.js";
import { sourceProvenance } from "../src/build-provenance.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-derived-")); const app = await LearningApplication.open(root, process.cwd());
  cleanups.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const source = path.join(root, "synthetic.md"); await fs.writeFile(source, "# Cache\n\nCache invalidation is required."); await app.importSelected("rag", source, new AbortController().signal);
  return { root, app };
}
it("rejects results when source changes during query embedding", async () => {
  const { app } = await fixture(); let change = false;
  const model = { id: "synthetic@1", embed: async (texts: string[]) => { if (change) app.database.db.prepare("UPDATE chunks SET text='new text', content_hash='changed'").run(); return texts.map(() => [1, 0]); } };
  const index = new SemanticIndex(app.database, model); await index.build("rag", new AbortController().signal); change = true;
  await expect(index.search("rag", "cache", new AbortController().signal)).rejects.toThrow("semantic_source_changed");
});
it("refuses to commit vectors derived from a stale build snapshot", async () => {
  const { app } = await fixture();
  const index = new SemanticIndex(app.database, { id: "synthetic@1", embed: async (texts) => { app.database.db.prepare("UPDATE chunks SET content_hash='changed'").run(); return texts.map(() => [1, 0]); } });
  await expect(index.build("rag", new AbortController().signal)).rejects.toThrow("semantic_source_changed");
  expect((app.database.db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get() as {n:number}).n).toBe(0);
});
it("invalidates legacy embedding recipes and changed document chunking recipes", async () => {
  const { app } = await fixture(), model = { id: "synthetic@1", embed: async (texts: string[]) => texts.map(() => [1, 0]) };
  const index = new SemanticIndex(app.database, model);
  app.database.db.prepare("INSERT INTO semantic_embeddings SELECT id, ?, content_hash, '[1,0]' FROM chunks").run(model.id);
  expect(index.indexedCount("rag")).toBe(0); await index.build("rag", new AbortController().signal); expect(index.indexedCount("rag")).toBe(1);
  app.database.db.prepare("UPDATE document_indexes SET recipe='synthetic-future'").run();
  expect(index.indexedCount("rag")).toBe(0); expect(await index.search("rag", "cache", new AbortController().signal)).toEqual([]);
});
it("excludes generated Python caches from reproducible source identity", async () => {
  const { root } = await fixture(); const src = path.join(root, "synthetic-source"); await fs.mkdir(path.join(src, "scripts"), {recursive:true}); await fs.writeFile(path.join(src, "scripts", "probe.py"), "print('synthetic')\n");
  const before = await sourceProvenance(src); await fs.mkdir(path.join(src, "scripts", "__pycache__")); await fs.writeFile(path.join(src, "scripts", "__pycache__", "probe.pyc"), "generated");
  expect((await sourceProvenance(src)).codeHash).toBe(before.codeHash);
});
