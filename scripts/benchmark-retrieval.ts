import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { LearningApplication } from "../src/learning-application.js";
import { OllamaEmbedding, SemanticIndex } from "../src/semantic-retrieval.js";
import { retrievalCorpus, retrievalQuestions } from "../src/retrieval-evaluation-cases.js";
import { evaluateRetrieval, summarizeRetrieval } from "../src/retrieval-evaluation.js";
import { atomicJson } from "../src/agent-session-store.js";

const argument = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = argument("output"), model = argument("model");
if (!output || process.argv.slice(2).some(arg => !/^--(?:output|model)=.+$/.test(arg))) throw new Error("usage: --output=new-report.json [--model=installed-local-model]");
await fs.writeFile(output, "{}\n", { flag: "wx", mode: 0o600 });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-retrieval-benchmark-"));
const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
const signal = AbortSignal.timeout(120_000);
try {
  for (const document of retrievalCorpus) {
    const file = path.join(root, document.name); await fs.writeFile(file, document.text);
    await app.importSelected(document.topic, file, signal);
  }
  const conditions = { dataset: "retrieval-development-v1", datasetHash: createHash("sha256").update(JSON.stringify({ documents: retrievalCorpus, questions: retrievalQuestions })).digest("hex"), corpus: retrievalCorpus, provenance: await app.provenance() };
  let index: SemanticIndex | undefined, modelIdentity: string | null = null, unavailable = "semantic_model_unavailable";
  let indexMs: number | null = null;
  if (model) try {
    const client = await OllamaEmbedding.connect(model, signal); modelIdentity = client.id; index = new SemanticIndex(app.database, client);
    const start = performance.now();
    for (const topic of new Set(retrievalCorpus.map(doc => doc.topic))) await index.build(topic, signal);
    indexMs = performance.now() - start; app.configureSemantic(model);
  } catch (error) { index = undefined; unavailable = error instanceof Error && /^semantic_[a-z_]+$/.test(error.message) ? error.message : "semantic_initialization_failed"; }
  const report = await evaluateRetrieval(retrievalQuestions, model ? ["lexical", "semantic", "hybrid"] : ["lexical"], async (arm, task) => {
    if (arm === "lexical") return { status: "completed", actualMode: "lexical", evidence: app.library.search(task.topic, task.query), modelIdentity: null };
    if (!index) return { status: "unavailable", reason: unavailable };
    if (arm === "semantic") return { status: "completed", actualMode: "semantic", evidence: app.database.withChunkContext(await index.search(task.topic, task.query, signal)), modelIdentity };
    const result = await app.searchDetailed(task.topic, task.query, signal);
    return { status: result.retrieval.mode === "hybrid" ? "completed" : "fallback", actualMode: result.retrieval.mode, evidence: result.evidence, modelIdentity };
  }, signal, 3, async partial => atomicJson(path.resolve(output), { ...partial, ...conditions, modelIdentity, indexMs, summary: summarizeRetrieval(partial) }, 4_000_000));
  const summary = summarizeRetrieval(report);
  console.log(JSON.stringify({ modelIdentity, indexMs, summary }, null, 2));
  if (report.rows.some(row => row.status !== "completed") || summary.groups.some(group => group.scopeViolations)) process.exitCode = 1;
} finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
