import { expect, it } from "vitest";
import { evaluateRag, ragQualityReport, summarizeRag, type RagCase } from "../src/rag-evaluation.js";
import { withSourceVersion } from "../src/source-version.js";
import { qualityReportHash, reviewQuality } from "../src/quality-review.js";
const evidence = withSourceVersion({ text: "仅在缓存命中时，延迟降低 20%。", score: 1, citation: { topicId: "rag", documentId: "00000000-0000-4000-8000-000000000001", documentName: "source.md", pageNumber: null, anchor: "experiment", chunkId: "00000000-0000-4000-8000-000000000002" } });
const task: RagCase = { id: "RAG01", topic: "rag", question: "缓存的延迟改善是多少？", relevant: [{ document: "source.md", anchor: "experiment", grade: 2 }], oracle: [evidence], criteria: ["条件保留", "不推断准确率"], expectation: "answer" };
it("keeps retrieval, oracle generation and end-to-end generation separate and withholds grading criteria", async () => {
  const seen: unknown[] = [];
  const report = await evaluateRag([task], { provider: "fixture", model: "fixture" }, async input => { expect(Object.keys(input).sort()).toEqual(["query", "topic"]); return []; }, async input => { seen.push(input); expect(input).not.toHaveProperty("criteria"); return { status: "completed", text: input.evidence.length ? "条件下改善。[source.md#anchor=experiment]" : "insufficient_evidence" }; }, new AbortController().signal);
  expect(seen).toHaveLength(2); expect(report.rows[0]?.retrieval.score?.recall).toBe(0);
  expect(report.rows[0]?.fixed.evidence).toEqual([evidence]); expect(report.rows[0]?.endToEnd.evidence).toEqual([]);
  expect(summarizeRag(report)).toMatchObject({ completedRetrieval: 1, retrievalRecall: 0, fixedCompleted: 1, endToEndCompleted: 1, reviewed: 0, answerQuality: "pending_review" });
  const quality = ragQualityReport(report);
  expect(quality.results).toHaveLength(2); expect(quality.results.every(row => row.review === "pending_human_review")).toBe(true);
  expect(quality.results.map(row => row.provider)).toEqual(["fixed:fixture", "end_to_end:fixture"]);
  expect(quality.results[0]?.criteria).toEqual(task.criteria);
  const review = { version: 1, reportHash: qualityReportHash(quality), reviewer: { name: "合成评分夹具", kind: "development_assistant", independent: false }, scores: [{ provider: "fixed:fixture", id: task.id, repetition: 1, criteria: ["fail", "pass"], rationale: "固定证据仍回答错误的合成评分", failures: ["accuracy"] }] };
  expect(reviewQuality(quality, review).scores[0]?.verdict).toBe("fail");
});
it("rejects cross-topic and stale retrieved bytes before end-to-end generation without hiding the oracle arm", async () => {
  for (const invalid of [{ ...evidence, citation: { ...evidence.citation, topicId: "tool-calling" } }, { ...evidence, text: "mutated text" }]) {
    let generations = 0;
    const report = await evaluateRag([task], { provider: "fixture", model: "fixture" }, async () => [invalid], async () => { generations++; return { status: "completed", text: "fixed only" }; }, new AbortController().signal);
    expect(generations).toBe(1); expect(report.rows[0]?.retrieval.status).toBe("invalid_evidence");
    expect(report.rows[0]?.fixed.status).toBe("completed"); expect(report.rows[0]?.endToEnd.status).toBe("not_attempted");
  }
});
it("records errors and cancellation with no new model request and no raw exception leakage", async () => {
  const controller = new AbortController(); let searches = 0, generations = 0, checkpoints = 0;
  const report = await evaluateRag([task, { ...task, id: "RAG02" }], { provider: "fixture", model: "fixture" }, async () => { searches++; return [evidence]; }, async () => { generations++; controller.abort(); throw new Error("private runtime output"); }, controller.signal, async () => { checkpoints++; });
  expect(searches).toBe(1); expect(generations).toBe(1); expect(checkpoints).toBeGreaterThanOrEqual(2);
  expect(report.rows[0]?.fixed.status).toBe("cancelled"); expect(report.rows[1]?.retrieval.status).toBe("cancelled");
  expect(JSON.stringify(report)).not.toContain("private runtime output");
  expect(summarizeRag(report).fixedCompleted).toBe(0);
  expect(ragQualityReport(report).results.map(row => row.attempted)).toEqual([true, false, false, false]);
});
it("bounds the experiment and validates oracle provenance before any side effect", async () => {
  for (const tasks of [[task, task], [{ ...task, oracle: [{ ...evidence, text: "changed" }] }], [{ ...task, expectation: "abstain", oracle: [evidence], relevant: task.relevant }]]) {
    await expect(evaluateRag(tasks as RagCase[], { provider: "fixture", model: "fixture" }, async () => { throw new Error("should not run"); }, async () => { throw new Error("should not run"); }, new AbortController().signal)).rejects.toThrow("rag_dataset_invalid");
  }
});

it("keeps dataset identity stable across imported UUIDs but changes it for changed source text", async () => {
  const run = (oracle: typeof task.oracle) => evaluateRag([{ ...task, oracle }], { provider: "fixture", model: "fixture" }, async () => [], async () => ({ status: "completed", text: "insufficient_evidence" }), new AbortController().signal);
  const first = await run([evidence]);
  const reimported = await run([{ ...evidence, citation: { ...evidence.citation, documentId: "00000000-0000-4000-8000-000000000003", chunkId: "00000000-0000-4000-8000-000000000004" } }]);
  expect(reimported.datasetHash).toBe(first.datasetHash);
  const changed = await run([withSourceVersion({ ...evidence, text: "仅在缓存命中时，延迟降低 10%。" })]);
  expect(changed.datasetHash).not.toBe(first.datasetHash);
});

it("runs actual import, retrieval, generation safeguards and review export via the bounded CLI", async () => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
  const { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-rag-runner-"));
  try {
    const output = path.join(root, "report.json");
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/benchmark-rag.ts", `--output=${output}`], { timeout: 25_000, env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
    const report = JSON.parse(await fs.readFile(output, "utf8"));
    expect(report.rows).toHaveLength(8); expect(report.summary).toMatchObject({ reviewed: 0, answerQuality: "pending_review", completedRetrieval: 8 });
    expect(report.conditions.generator).toBe("synthetic_fixture"); expect(report.modelCalls).toBeLessThanOrEqual(16);
    const quality = JSON.parse(await fs.readFile(path.join(root, "report.quality.json"), "utf8"));
    expect(quality.conditions).toMatchObject({ codeHash: report.conditions.provenance.codeHash, requestedReasoning: report.conditions.reasoning, details: report.conditions });
    expect(quality.evaluationDesign.datasetClassification).toBe("development");
    expect(quality).toEqual(report.qualityReport); expect(quality.results).toHaveLength(16);
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/review-agent-quality.ts", `--report=${path.join(root, "report.quality.json")}`], { timeout: 10_000 });
    expect(JSON.parse(result.stdout).passRate).toBeNull();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it("persists the exact phase dispatch before generation and refuses model work on a checkpoint failure", async () => {
  let last: Awaited<ReturnType<typeof evaluateRag>> | undefined;
  let calls = 0;
  await evaluateRag([task], { provider: "fixture", model: "fixture" }, async () => [evidence], async () => {
    calls++; const row = last!.rows[0]!;
    expect(calls === 1 ? row.fixed : row.endToEnd).toMatchObject({ status: "running", attempted: true, evidence: [evidence] });
    return { status: "completed", text: "fixture" };
  }, new AbortController().signal, async report => { last = structuredClone(report); });
  expect(calls).toBe(2); calls = 0;
  await expect(evaluateRag([task], { provider: "fixture", model: "fixture" }, async () => [evidence], async () => { calls++; return { status: "completed", text: "fixture" }; }, new AbortController().signal, async report => {
    if (report.rows[0]?.fixed.status === "running") throw new Error("storage unavailable");
  })).rejects.toThrow("storage unavailable");
  expect(calls).toBe(0);
});
it("freezes the full RAG rubric before the first question, keeping it stable across partial checkpoints", async () => {
  const hashes: string[] = [];
  await evaluateRag([task, { ...task, id: "RAG02", criteria: ["second fixed rubric"] }], { provider: "fixture", model: "fixture" }, async () => [evidence], async () => ({ status: "completed", text: "fixture" }), new AbortController().signal, async report => {
    const design = ragQualityReport(report).evaluationDesign!;
    expect(design.caseIds).toEqual([task.id, "RAG02"]); hashes.push(design.rubricHash);
  });
  expect(new Set(hashes).size).toBe(1);
});
