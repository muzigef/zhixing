import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { ragCases, ragCorpus } from "../src/rag-evaluation-cases.js";
import { evaluateRag, ragQualityReport, summarizeRag, type RagReport } from "../src/rag-evaluation.js";
import { sourceHash, withSourceVersion } from "../src/source-version.js";
import { atomicJson } from "../src/agent-session-store.js";
import { inspectEvidenceSupport } from "../src/evidence-support.js";
import { answerFromEvidence } from "../src/grounded-answer.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { NativeAgentExecutor } from "../src/native-agent.js";
import { executeAgent } from "../src/agent-executor.js";
import type { ModelClient, ModelUsage } from "../src/model.js";
import type { SearchResult } from "../src/contracts.js";

const argument = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = argument("output"), provider = argument("provider") ?? "demo", embedding = argument("embedding"), selected = argument("case")?.split(",");
if (!output || !["demo", "native-codex"].includes(provider) || process.argv.slice(2).some(arg => arg !== "--live" && !/^--(?:output|provider|embedding|case)=.+$/.test(arg))) throw new Error("usage: --output=new-report.json [--provider=demo|native-codex --live] [--embedding=installed-model] [--case=RAG01]");
if (provider !== "demo" && (!process.argv.includes("--live") || process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0")) throw new Error("live_provider_not_authorized");
if (selected?.some(id => !ragCases.some(task => task.id === id)) || selected && new Set(selected).size !== selected.length) throw new Error("rag_case_invalid");
const qualityOutput = output.replace(/\.json$/, "") + ".quality.json";
await fs.writeFile(output, "{}\n", { flag: "wx", mode: 0o600 });
await fs.writeFile(qualityOutput, "{}\n", { flag: "wx", mode: 0o600 });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-rag-benchmark-"));
const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
const signal = AbortSignal.timeout(600_000);
let modelCalls = 0, usage: ModelUsage | undefined, rawText = "";
const native = new NativeAgentExecutor("codex");
try {
  for (const document of ragCorpus) { const file = path.join(root, document.name); await fs.writeFile(file, document.text); await app.importSelected(document.topic, file, signal); }
  if (embedding) { app.configureSemantic(embedding); await app.indexSemantic("rag", signal); }
  const tasks = ragCases.filter(task => !selected || selected.includes(task.id)).map(task => ({ ...task, oracle: task.relevant.flatMap(ref => (app.database.db.prepare("SELECT c.text, c.id AS chunkId, c.page_number AS pageNumber, c.anchor, d.id AS documentId, d.name AS documentName FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.topic_id=? AND d.name=? AND c.anchor=? ORDER BY c.rowid").all(task.topic, ref.document, ref.anchor) as { text: string; chunkId: string; pageNumber: number | null; anchor: string; documentId: string; documentName: string }[]).map(({ text, ...citation }) => withSourceVersion({ text, score: 1, citation: { ...citation, topicId: task.topic } }))) }));
  const conditions = { dataset: "rag-layered-development-v1", corpusHash: sourceHash(JSON.stringify(ragCorpus)), corpus: ragCorpus, provenance: await app.provenance(), retrieval: embedding ? "hybrid" : "lexical", embedding: embedding ?? null, provider, generator: provider === "demo" ? "synthetic_fixture" : "official_subscription", reasoning: "quick", budgets: { maxQuestions: 8, maxModelCalls: 16, maxOutputCharactersPerCall: 8000, totalDeadlineMs: 600_000 } };
  let activeReport: RagReport | undefined;
  const persist = async (partial: RagReport) => {
    activeReport = partial; const quality = ragQualityReport(partial, { dataset: conditions.dataset, codeHash: conditions.provenance.codeHash, provenance: conditions.provenance, requestedReasoning: conditions.reasoning, details: conditions });
    await atomicJson(path.resolve(output), { ...partial, conditions, modelCalls, summary: summarizeRag(partial), qualityReport: quality }, 8_000_000);
    await atomicJson(path.resolve(qualityOutput), quality, 4_000_000);
  };
  const client: ModelClient = { async *stream(prompt, parent) {
    if (modelCalls >= 16) throw new Error("rag_model_budget");
    modelCalls++; if (activeReport) await persist(activeReport);
    if (provider === "demo") { yield { type: "text_delta", text: "insufficient_evidence：离线夹具仅验证评测流程，不模拟真实回答质量。" }; yield { type: "done" }; return; }
    const result = await executeAgent(native, { prompt, reasoning: "quick", maxOutputChars: 8000 }, AbortSignal.any([parent, AbortSignal.timeout(120_000)]));
    rawText = result.text; usage = result.usage; yield { type: "text_delta", text: result.text }; if (usage) yield { type: "usage", usage }; yield { type: "done" };
  } };
  const runtime = providerRuntime(provider, client);
  const report = await evaluateRag(tasks, { provider, model: provider === "demo" ? "synthetic-fixture" : native.identity.model }, async ({ topic, query }) => {
    const found = await app.searchDetailed(topic, query, signal);
    if (embedding && found.retrieval.mode !== "hybrid") throw new Error("rag_retrieval_fallback");
    for (const item of found.evidence) await app.source(topic, item.citation);
    return found.evidence as SearchResult[];
  }, async ({ question, evidence }, parent) => {
    usage = undefined; rawText = ""; const text = await answerFromEvidence(runtime, question, evidence, true, parent);
    return { status: "completed", text, usage, reasoning: "quick", grounding: { rawText, support: inspectEvidenceSupport(rawText, evidence.slice(0, 3)) } };
  }, signal, persist);
  console.log(JSON.stringify({ modelCalls, summary: summarizeRag(report) }, null, 2));
  if (report.rows.some(row => row.retrieval.status !== "completed" || row.fixed.status !== "completed" || row.endToEnd.status !== "completed")) process.exitCode = 1;
} finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
