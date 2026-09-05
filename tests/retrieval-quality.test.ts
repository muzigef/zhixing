import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { SemanticIndex, OllamaEmbedding } from "../src/semantic-retrieval.js";

it("retrieves Chinese synonyms and English terms, excludes unrelated hash matches, and includes neighboring evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-retrieval-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    const source = path.join(root, "cache.md"); await fs.writeFile(source, "# Cache\n\nCache invalidation prevents stale responses.\n\n# 证据\n\n" + "背景文字".repeat(260) + "相邻块补充：更新数据后必须失效检索缓存。");
    await app.importSelected("rag", source, new AbortController().signal);
    expect(app.library.search("rag", "为什么缓存有旧数据？")[0]?.text).toContain("stale");
    expect(app.library.search("rag", "线性回归的梯度求导")).toHaveLength(0);
    expect(app.library.search("tool-calling", "缓存")).toHaveLength(0);
    const context = await app.context("rag", "相邻块补充 缓存", true, new AbortController().signal);
    expect(context.evidence.length).toBeGreaterThan(1);
    const general = await app.context("rag", "继续推导线性回归的梯度", true, new AbortController().signal);
    expect(general.text).toBe("");
    const progress = await app.context("rag", "检查进度", true, new AbortController().signal);
    expect(progress.text).toContain("agent-development/D01");
    expect(progress.text).toContain("prerequisiteBlockers");
    expect(new Set(context.evidence.map((item) => item.citation.chunkId)).size).toBe(context.evidence.length);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("indexes learned vectors separately by model revision and invalidates stale document hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-semantic-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    const source = path.join(root, "concept.md"); await fs.writeFile(source, "# 概念\n\nApple is a fruit.\n\n# 系统\n\nTransaction isolation keeps concurrent writes consistent.");
    await app.importSelected("rag", source, new AbortController().signal);
    const model = { id: "fixture-semantic@v1", embed: async (texts: string[]) => texts.map((text) => /fruit|水果/i.test(text) ? [1, 0] : [0, 1]) };
    const index = new SemanticIndex(app.database, model);
    expect((await index.build("rag", new AbortController().signal)).indexed).toBe(2);
    expect((await index.search("rag", "水果", new AbortController().signal))[0]?.text).toContain("Apple");
    expect(await index.search("tool-calling", "水果", new AbortController().signal)).toEqual([]);
    expect(await new SemanticIndex(app.database, { ...model, id: "fixture-semantic@v2" }).search("rag", "水果", new AbortController().signal)).toEqual([]);
    app.database.db.prepare("UPDATE chunks SET content_hash = 'changed'").run();
    expect(await index.search("rag", "水果", new AbortController().signal)).toEqual([]);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("rejects embeddings if the installed model changes during a request", async () => {
  let digest = "revision-one";
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/tags")) return Response.json({ models: [{ name: "fixture:latest", digest }] });
    digest = "revision-two"; return Response.json({ embeddings: [[1, 0]] });
  });
  try {
    const model = await OllamaEmbedding.connect("fixture", new AbortController().signal);
    await expect(model.embed(["合成材料"], new AbortController().signal)).rejects.toThrow("semantic_model_changed");
  } finally { vi.unstubAllGlobals(); }
});
