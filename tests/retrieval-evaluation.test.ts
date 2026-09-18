import { expect, it } from "vitest";
import { scoreRetrieval, summarizeRetrieval, evaluateRetrieval } from "../src/retrieval-evaluation.js";
import { retrievalCorpus, retrievalQuestions } from "../src/retrieval-evaluation-cases.js";
import type { SearchResult } from "../src/contracts.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const hit = (name: string, anchor = "intro", text = "source"): SearchResult => ({ text, score: 1, citation: { topicId: "rag", documentId: name, documentName: name, pageNumber: null, anchor } });
const question = { id: "fixture", topic: "rag", query: "source", relevant: [{ document: "a.md", anchor: "intro", grade: 2 as const }, { document: "b.md", anchor: "intro", grade: 1 as const }] };
it("scores ranked distinct sources without counting repeated chunks as extra recall", () => {
  const score = scoreRetrieval(question, [hit("a.md"), hit("a.md"), hit("b.md")], 3);
  expect(score).toMatchObject({ recall: 1, precision: 2 / 3, reciprocalRank: 1, relevantRetrieved: 2 });
  expect(score.ndcg).toBeGreaterThan(0.9); expect(score.ndcg).toBeLessThan(1);
  expect(scoreRetrieval(question, [hit("a.md", "wrong"), hit("a.md")], 1).recall).toBe(0);
  expect(() => scoreRetrieval(question, [], 0)).toThrow();
});
it("treats no-answer queries separately and does not manufacture perfect recall on empty truth", () => {
  const negative = { ...question, relevant: [] };
  expect(scoreRetrieval(negative, [], 3)).toMatchObject({ recall: null, reciprocalRank: null, ndcg: null, falsePositive: false });
  expect(scoreRetrieval(negative, [hit("noise.md")], 3).falsePositive).toBe(true);
});
it("separates lexical fallback and unavailable semantic rows from successful semantic evaluation", async () => {
  const report = await evaluateRetrieval([question], ["lexical", "semantic", "hybrid"], async arm => arm === "semantic" ? { status: "unavailable", reason: "semantic_model_unavailable" } : { status: arm === "hybrid" ? "fallback" : "completed", actualMode: "lexical", evidence: [hit("a.md")], modelIdentity: null }, new AbortController().signal);
  const summary = summarizeRetrieval(report);
  expect(summary.groups.find(group => group.arm === "lexical")).toMatchObject({ completed: 1, meanRecall: 0.5 });
  expect(summary.groups.find(group => group.arm === "semantic")).toMatchObject({ completed: 0, unavailable: 1, meanRecall: null });
  expect(summary.groups.find(group => group.arm === "hybrid")).toMatchObject({ completed: 0, fallback: 1, meanRecall: null });
});
it("binds annotations to the corpus, records aborted rows, and rejects duplicate question IDs", async () => {
  expect(retrievalQuestions.length).toBeGreaterThanOrEqual(20);
  for (const task of retrievalQuestions) for (const ref of task.relevant) expect(retrievalCorpus.some(doc => doc.name === ref.document && doc.topic === task.topic && doc.text.includes(`# ${ref.anchor}`))).toBe(true);
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  const report = await evaluateRetrieval([question], ["lexical"], async () => { calls++; return { status: "completed", actualMode: "lexical", evidence: [], modelIdentity: null }; }, aborted.signal);
  expect(calls).toBe(0); expect(report.rows[0]?.status).toBe("cancelled");
  await expect(evaluateRetrieval([question, question], ["lexical"], async () => ({ status: "unavailable", reason: "test" }), new AbortController().signal)).rejects.toThrow();
});
it("runs the public corpus through real import/search and exports corpus and source hashes without a model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-retrieval-runner-"));
  try {
    const output = path.join(root, "results.json");
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/benchmark-retrieval.ts", `--output=${output}`], { cwd: process.cwd(), timeout: 25_000, env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
    const report = JSON.parse(await fs.readFile(output, "utf8"));
    expect(report.rows).toHaveLength(retrievalQuestions.length); expect(report.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.summary.groups).toHaveLength(1); expect(report.summary.groups[0]).toMatchObject({ arm: "lexical", scopeViolations: 0, completed: retrievalQuestions.length });
    expect(report.modelIdentity).toBeNull(); expect(report.corpus).toHaveLength(retrievalCorpus.length);
    expect(report.rows.filter((row: { evidence: SearchResult[] }) => row.evidence.length).every((row: { evidence: SearchResult[] }) => row.evidence.every(item => item.citation.contentHash?.length === 64))).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
