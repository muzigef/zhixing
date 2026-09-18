import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { chunkDocumentText, splitMarkdownSections } from "../src/document-chunking.js";
import { LearningApplication } from "../src/learning-application.js";

it("keeps a bounded table with its immediately preceding condition despite preceding context pressure", () => {
  const condition = "条件：下列数值仅适用于命中请求。\n\n";
  const table = "| 请求类型 | 延迟 |\n| --- | --- |\n" + Array.from({ length: 24 }, (_, i) => `| mode${i} | ${i + 1} ms |\n`).join("");
  const text = "背景。".repeat(270) + "\n\n" + condition + table;
  const chunks = chunkDocumentText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.find(chunk => chunk.includes("mode23"))).toContain(condition + table);
  expect(chunks.every(chunk => chunk.length <= 1000)).toBe(true);
});
it("retains a formula and its preceding conditions without dropping bytes or interpreting instructions", () => {
  const formula = "条件：只有 x 大于零时使用下面的表达式。\n\n$$\ny = \\log(x)\n$$\n";
  const text = "背景。".repeat(323) + "\n\n" + formula;
  const chunks = chunkDocumentText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.find(chunk => chunk.includes("\\log(x)"))).toContain(formula);
});
it("treats headings in fenced code as source text and bounds anchors without changing their source", () => {
  const text = "# Real\n\n~~~python\n# Fake\nprint('do not execute')\n~~~\n\n# Next\nnext\n";
  const sections = splitMarkdownSections(text);
  expect(sections.map(section => section.anchor)).toEqual(["Real", "Next"]);
  expect(sections.map(section => section.text).join("")).toBe(text);
  const longHeading = "# " + "😀".repeat(600) + "\n正文";
  const first = splitMarkdownSections(longHeading)[0]!;
  expect(first.anchor!.length).toBeLessThanOrEqual(1000);
  expect(() => encodeURIComponent(first.anchor!)).not.toThrow();
  expect(first.text).toBe(longHeading);
  expect(splitMarkdownSections("无标题的公开材料")[0]?.anchor).toBe("root");
});
it("splits oversized blocks on available line boundaries and preserves Unicode and every original character", () => {
  const table = "| Key | Value |\n| --- | --- |\n" + Array.from({ length: 150 }, (_, i) => `| row${i} | ${"😀".repeat(10)} |\n`).join("");
  const text = table + "\n```\n" + "长段落😀".repeat(700) + "\n```\n";
  const chunks = chunkDocumentText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every(chunk => chunk.length <= 1000)).toBe(true);
  for (const chunk of chunks) expect(() => encodeURIComponent(chunk)).not.toThrow();
  expect(chunks.filter(chunk => chunk.includes("row")).every(chunk => !chunk.includes("row149") ? chunk.endsWith("\n") : true)).toBe(true);
});
it("retrieves table conditions through the actual importer and keeps source navigation exact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-structure-"));
  const app = await LearningApplication.open(root, process.cwd());
  try {
    const file = path.join(root, "table.md");
    const condition = "条件：仅对缓存命中的请求有效。\n\n";
    const table = "| 类型 | 限额 |\n| --- | --- |\n" + Array.from({ length: 24 }, (_, i) => `| mode${i} | ${i + 1} tokens |\n`).join("");
    await fs.writeFile(file, "# 缓存限额\n\n" + "背景。".repeat(270) + "\n\n" + condition + table);
    await app.importSelected("rag", file, new AbortController().signal);
    const result = app.library.search("rag", "mode23")[0]!;
    expect(result.text).toContain(condition); expect(result.text).toContain("| 类型 | 限额 |");
    expect((await app.source("rag", result.citation)).text).toBe(result.text);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("brings the original header and condition alongside a row in an oversized table through shared search", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-large-table-"));
  const app = await LearningApplication.open(root, process.cwd());
  try {
    const file = path.join(root, "table.md");
    const condition = "条件：仅对缓存命中的请求有效。";
    await fs.writeFile(file, "# 缓存限额\n\n" + "背景。".repeat(270) + `\n\n${condition}\n\n| 类型 | 限额 |\n| --- | --- |\n` + Array.from({ length: 180 }, (_, i) => `| mode${i} | ${i + 1} tokens |\n`).join(""));
    const imported = await app.importSelected("rag", file, new AbortController().signal);
    const evidence = await app.search("rag", "mode179", new AbortController().signal);
    const first = evidence.slice(0, 3).map(item => item.text).join("\n");
    expect(first).toContain("mode179"); expect(first).toContain("| 类型 | 限额 |"); expect(first).toContain(condition);
    for (const item of evidence.slice(0, 3)) expect((await app.source("rag", item.citation)).text).toBe(item.text);
    const tools = app.tools(true); const result = await tools.harness.execute("search_materials", { query: "mode179" }, { topicId: "rag", signal: new AbortController().signal });
    expect(JSON.stringify(result.output)).toContain(condition); expect(JSON.stringify(result.output)).toContain("| 类型 | 限额 |");
    const otherDocument = crypto.randomUUID(), otherChunk = crypto.randomUUID();
    app.database.addDocument(otherDocument, "tool-calling", "synthetic-other-hash", "other.md", "text/markdown");
    app.database.addChunk(otherChunk, "tool-calling", otherDocument, "Cross-topic material must stay private", null, "root", "synthetic-other-text");
    app.database.db.prepare("INSERT INTO chunk_context(chunk_id,context_id) VALUES (?,?)").run(evidence[0]!.citation.chunkId, otherChunk);
    expect(JSON.stringify(await app.search("rag", "mode179", new AbortController().signal))).not.toContain("Cross-topic material");
    app.database.db.prepare("UPDATE document_indexes SET recipe='legacy-character-v1' WHERE document_id=?").run(imported.documentId);
    expect((await app.importSelected("rag", file, new AbortController().signal)).status).toBe("indexed");
    expect((await app.importSelected("rag", file, new AbortController().signal)).status).toBe("duplicate");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
