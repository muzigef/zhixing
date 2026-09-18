import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { LearningApplication } from "../src/learning-application.js";
import { sourceProvenance } from "../src/build-provenance.js";

const condition = "条件：仅对缓存命中的请求有效。";
const table = (count: number) => "| 类型 | 限额 |\n| --- | --- |\n" + Array.from({ length: count }, (_, i) => `| mode${i} | ${i + 1} tokens |\n`).join("");
const cases = [
  { id: "bounded-table", text: "# 缓存\n\n" + "背景。".repeat(270) + `\n\n${condition}\n\n` + table(24), query: "mode23", spans: [condition, "| 类型 | 限额 |", "mode23"] },
  { id: "formula-condition", text: "背景。".repeat(323) + "\n\n条件：只有 x 大于零时使用下面的表达式。\n\n$$\ny = \\log(x)\n$$\n", query: "log", spans: ["只有 x 大于零", "\\log(x)"] },
  { id: "oversized-table", text: "# 缓存\n\n" + "背景。".repeat(270) + `\n\n${condition}\n\n` + table(180), query: "mode179", spans: [condition, "| 类型 | 限额 |", "mode179"] },
  { id: "quoted-heading", text: "# Real\n\n```text\n# Fake\nunique_code_anchor\n```\n", query: "unique_code_anchor", spans: ["unique_code_anchor"], anchor: "Real" },
  { id: "unrelated-control", text: "# Cache\n\nA cache stores previous results.", query: "galactic", spans: [], empty: true },
];
// Frozen c373c03 library.ts baseline. Used only for a declared development comparison.
function legacyChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1000, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline > start + 500) end = newline + 1;
      if (/[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
    }
    chunks.push(text.slice(start, end)); start = end;
  }
  return chunks;
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-chunk-probes-"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
try {
  const results = [];
  for (const arm of ["legacy-c373c03", "structure-v1"] as const) for (const task of cases) {
    const app = await LearningApplication.open(path.join(root, arm, task.id), process.cwd());
    try {
      if (arm === "legacy-c373c03") {
        const documentId = randomUUID(); app.database.addDocument(documentId, "rag", hash(task.text), `${task.id}.md`, "text/markdown");
        for (const section of task.text.split(/(?=^#{1,6}\s)/m)) for (const text of legacyChunks(section)) app.database.addChunk(randomUUID(), "rag", documentId, text, null, /^#+\s+(.+)$/m.exec(section)?.[1] ?? null, hash(text));
      } else {
        const file = path.join(root, `${task.id}.md`); await fs.writeFile(file, task.text);
        await app.importSelected("rag", file, new AbortController().signal);
      }
      const selected = (await app.search("rag", task.query, new AbortController().signal)).slice(0, 3);
      const text = selected.map(item => item.text).join("\n");
      const foundSpans = task.spans.map(span => ({ span, present: text.includes(span) }));
      const passed = task.empty ? selected.length === 0 : foundSpans.every(span => span.present) && (!task.anchor || selected[0]?.citation.anchor === task.anchor);
      results.push({ arm, id: task.id, passed, foundSpans, selected: selected.map(item => ({ text: item.text, anchor: item.citation.anchor, contentHash: item.citation.contentHash })) });
    } finally { app.close(); }
  }
  process.stdout.write(JSON.stringify({ version: 1, dataset: "structure-development-probes-v1", datasetHash: hash(JSON.stringify(cases)), provenance: await sourceProvenance(process.cwd()), k: 3, results, interpretation: "五组公开开发回归探针；度量所需原文片段是否进入前三条及锚点是否正确，包含未检索控制。不是未见保留集、真实语义检索分数或最终回答正确率。" }, null, 2) + "\n");
} finally { await fs.rm(root, { recursive: true, force: true }); }
