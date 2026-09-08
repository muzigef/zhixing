import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectEvidenceSupport } from "../src/evidence-support.js";
import { answerFromEvidence } from "../src/grounded-answer.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { LearningApplication } from "../src/learning-application.js";

const citation = { topicId: "rag", documentId: "synthetic", documentName: "实验.md", pageNumber: null, anchor: "结果" };
const marker = "[实验.md#anchor=结果]";
it("rejects unsupported measurements even with an exact legitimate citation", async () => {
  const evidence = [{ citation, text: "引入检索缓存，尚未测量成本变化。", score: 1 }];
  const text = `成本降低了 90%。${marker}`;
  const report = inspectEvidenceSupport(text, evidence);
  expect(report.issues).toContainEqual(expect.objectContaining({ code: "unsupported_quantity" }));
  expect(report.method).toBe("deterministic_checks");
  expect(report.claims[0]?.sources[0]).toMatchObject({ citation, excerptStart: 0, excerptEnd: evidence[0]!.text.length, excerptHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  const client = { async *stream() { yield { type: "text_delta" as const, text }; yield { type: "done" as const }; } };
  expect(await answerFromEvidence(providerRuntime("mock", client), "成本改善多少", evidence, true, new AbortController().signal)).toContain("insufficient_evidence");
});
it("distinguishes cautious inference from universal claims and fabricated direct quotations", () => {
  const evidence = [{ citation, text: "缓存可能减少请求，但失效策略错误时仍会读取旧数据。", score: 1 }];
  expect(inspectEvidenceSupport(`缓存保证不会读取旧数据。${marker}`, evidence).issues.map(item => item.code)).toContain("overstated_claim");
  expect(inspectEvidenceSupport(`推断：缓存可能减少请求，仍需测试失效策略。${marker}`, evidence).issues).toEqual([]);
  expect(inspectEvidenceSupport(`原文说“所有请求都能保证完全一致”。${marker}`, evidence).issues.map(item => item.code)).toContain("unverified_quote");
  expect(inspectEvidenceSupport(`原文说“缓存可能减少请求”。${marker}`, evidence).issues).toEqual([]);
});
it("keeps numeric checking bound to the cited claim and avoids treating example code as measurement", () => {
  const source = [{ citation, text: "成本降低 20%，总请求为 100 次。", score: 1 }];
  expect(inspectEvidenceSupport(`成本降低 20%。${marker}`, source).issues).toEqual([]);
  expect(inspectEvidenceSupport(`成本降低 90%。${marker}`, [{ citation, text: "命中率提高到 90%，成本尚未测量。", score: 1 }]).issues.map(item => item.code)).toContain("unsupported_quantity");
  expect(inspectEvidenceSupport("```js\nconst ratio = 90 / 100;\n```\n示例代码，不是实测。", source).issues).toEqual([]);
  expect(inspectEvidenceSupport(`成本降低 90%。\n其他信息 ${marker}`, source).issues.map(item => item.code)).toContain("uncited_quantity");
});
it("distinguishes explicitly rejected quantities from positive measurements in the same answer", () => {
  const source = [{ citation, text: "资料没有微调的训练费用或具体性能。", score: 1 }];
  expect(inspectEvidenceSupport(`资料不能证明“微调比 RAG 每月便宜 200 元”。${marker}`, source).issues).toEqual([]);
  expect(inspectEvidenceSupport(`无法根据资料证明成本降低 200 元。${marker}`, source).issues).toEqual([]);
  expect(inspectEvidenceSupport(`不能证明成本降低 200 元，但是延迟降低 90%。${marker}`, source).issues.map(issue => issue.code)).toContain("unsupported_quantity");
  expect(inspectEvidenceSupport(`成本降低 200 元。不能证明延迟降低 90%。${marker}`, source).issues.map(issue => issue.code)).toContain("unsupported_quantity");
});
it("binds retrieved excerpts to source bytes and rejects a source changed after the answer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-source-version-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    const file = path.join(root, "synthetic.md"); await fs.writeFile(file, "# 成本\n\n合成成本变化尚未测量。");
    await app.importSelected("rag", file, new AbortController().signal);
    const source = (await app.search("rag", "成本"))[0]!;
    expect(source.citation.contentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(app.source("rag", source.citation)).resolves.toMatchObject({ text: source.text });
    app.database.db.prepare("UPDATE chunks SET text=? WHERE id=?").run("合成内容已修改", source.citation.chunkId);
    await expect(app.source("rag", source.citation)).rejects.toThrow("citation_version_mismatch");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it.each([true, false])("repairs unsupported cited answers through the actual service with one retry (repair=%s)", async repair => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-support-service-")); const app = await LearningApplication.open(root, process.cwd());
  const { AgentService } = await import("../src/agent-service.js"); const { AgentSessionStore } = await import("../src/agent-session-store.js");
  let calls = 0;
  const bad = "成本降低 90%。[metrics.md#anchor=成本]";
  const client = { async *stream() { calls++; yield { type: "text_delta" as const, text: bad }; yield { type: "done" as const }; }, async *continue(_prompt: string, _results: readonly unknown[], _signal: AbortSignal, options?: import("../src/model.js").ModelRequestOptions) {
    calls++; expect(JSON.stringify(options?.history)).toContain("证据支持检查");
    expect(JSON.stringify(options?.history)).toContain("直接重写对原问题的完整回答");
    yield { type: "text_delta" as const, text: repair ? "资料尚未测量成本变化，无法给出降幅。[metrics.md#anchor=成本]" : bad }; yield { type: "done" as const };
  } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app);
  try {
    const file = path.join(root, "metrics.md"); await fs.writeFile(file, "# 成本\n\n资料尚未测量成本变化。"); await app.importSelected("rag", file, new AbortController().signal);
    const session = await service.create(); await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", text: "根据资料，成本降低多少？", topicId: "rag", contextAllowed: true }); await service.idle();
    const message = (await service.load(session.id)).messages.at(-1)!;
    expect(message.status).toBe(repair ? "completed" : "blocked"); expect(calls).toBe(2);
    expect(message.text).not.toContain("90%"); expect(JSON.stringify(message.items)).not.toContain("90%");
    expect(message.evidenceSupport?.issues.length).toBe(repair ? 0 : 1);
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
