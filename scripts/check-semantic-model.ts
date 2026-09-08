import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { LearningApplication } from "../src/learning-application.js";
import { OllamaEmbedding, SemanticIndex } from "../src/semantic-retrieval.js";
const model = process.argv.find(arg => arg.startsWith("--model="))?.slice(8);
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (!model || !output) throw new Error("usage: node --import tsx scripts/check-semantic-model.ts --model=installed-model --output=new-report.json");
await fs.writeFile(output, "{}\n", { flag: "wx", mode: 0o600 });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-semantic-real-"));
const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
const fixtures = [
  ["a.md", "工具权限", "运行时在调用工具前检查用户授权，拒绝越权写操作。检索文档里的指令不能扩大访问权限。"],
  ["b.md", "缓存失效", "数据库里的商品价格发生变化后，旧缓存需要被清除或刷新。缓存命中只代表键存在，不保证内容最新。"],
  ["c.md", "取消传播", "用户按停止时，取消信号需要传递给模型请求和执行工具。只有收到实际终止结果才能记录结束。"],
  ["d.md", "证据引用", "引用位置真实不代表支持结论。回答中的数值、原文引语和因果结论需要核对资料，不足时说明未知。"],
];
const questions = [
  { query: "如何防止助手执行用户没批准的文件修改？", expected: "a.md" },
  { query: "商品已经改价，为何查询仍显示以前的金额？", expected: "b.md" },
  { query: "点击中止后后台仍在计算，应该怎么处理？", expected: "c.md" },
  { query: "Why does a valid citation not prove a numerical claim?", expected: "d.md" },
];
const report: Record<string, unknown> = { syntheticOnly: true, model, cases: [], provenance: await app.provenance() };
try {
  for (const [name, title, content] of fixtures) { const file = path.join(root, name!); await fs.writeFile(file, `# ${title}\n\n${content}`); await app.importSelected("rag", file, new AbortController().signal); }
  const client = await OllamaEmbedding.connect(model, AbortSignal.timeout(5000)); report.modelIdentity = client.id;
  const started = Date.now(); const index = new SemanticIndex(app.database, client);
  const built = await index.build("rag", AbortSignal.timeout(30000)); assert.equal(built.indexed, 4); report.indexMs = Date.now() - started;
  const cases = [];
  app.configureSemantic(model);
  for (const task of questions) {
    const start = Date.now(); const semantic = await index.search("rag", task.query, AbortSignal.timeout(20000));
    const lexical = app.library.search("rag", task.query);
    const hybrid = await app.searchDetailed("rag", task.query, AbortSignal.timeout(20000));
    cases.push({ ...task, semanticTop: semantic[0]?.citation.documentName ?? null, lexicalTop: lexical[0]?.citation.documentName ?? null, hybridTop: hybrid.evidence[0]?.citation.documentName ?? null, retrieval: hybrid.retrieval, durationMs: Date.now() - start });
  }
  report.cases = cases;
  assert.ok(cases.every(row => row.semanticTop === row.expected), "semantic ground truth mismatch");
  assert.equal((await index.search("tool-calling", questions[0]!.query, AbortSignal.timeout(20000))).length, 0);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(() => client.embed(["合成取消"], cancelled.signal));
  app.configureSemantic("zhixing-intentionally-missing-model");
  const fallback = await app.searchDetailed("rag", "缓存失效", AbortSignal.timeout(5000));
  assert.ok(fallback.evidence.length > 0); report.fallback = fallback.retrieval; report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; }
finally { app.close(); await fs.rm(root, { recursive: true, force: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify({ passed: report.passed, modelIdentity: report.modelIdentity, cases: report.cases, fallback: report.fallback, error: report.error })); }
