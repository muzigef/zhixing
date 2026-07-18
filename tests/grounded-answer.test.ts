import { describe, expect, it } from "vitest";
import { answerFromEvidence } from "../src/grounded-answer.js";
import { MockModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";
import type { ModelClient } from "../src/model.js";

const evidence = [{ text: "RAG needs citations.", score: 1, citation: { topicId: "rag" as const, documentId: "d", documentName: "notes.md", pageNumber: null, anchor: "Grounding" } }];
function runtime() { const registry = new ProviderRegistry(); const client = new MockModelClient(); registry.register({ id: "mock", client, health: async () => "healthy" as const }); registry.route("tutor", "mock"); return new ProviderRuntime(registry, client); }
describe("grounded answer", () => {
  it("无证据拒答，未确认时不外发证据", async () => {
    await expect(answerFromEvidence(runtime(), "what", [], false, new AbortController().signal)).resolves.toContain("insufficient_evidence");
    await expect(answerFromEvidence(runtime(), "what", evidence, false, new AbortController().signal)).rejects.toThrow("external_content_confirmation_required");
    await expect(answerFromEvidence(runtime(), "what", [{ ...evidence[0]!, citation: { ...evidence[0]!.citation, anchor: null } }], true, new AbortController().signal)).resolves.toContain("insufficient_evidence");
  });
  it("按需注入当前工作流 Skill 摘要", async () => {
    const registry = new ProviderRegistry();
    const echo: ModelClient = { async *stream(prompt) { yield { type: "text_delta", text: prompt }; yield { type: "done" }; } };
    registry.register({ id: "echo", client: echo, health: async () => "healthy" as const });
    registry.route("tutor", "echo");
    await expect(answerFromEvidence(new ProviderRuntime(registry, new MockModelClient()), "what", evidence, true, new AbortController().signal, undefined, undefined, [{ name: "rag-grounding", description: "cite evidence" }])).resolves.toContain("rag-grounding");
  });
  it("模型省略 citation 时拒绝不受证据约束的答案", async () => {
    const registry = new ProviderRegistry();
    const ungrounded: ModelClient = { async *stream() { yield { type: "text_delta", text: "没有引用的结论" }; yield { type: "done" }; } };
    registry.register({ id: "ungrounded", client: ungrounded, health: async () => "healthy" as const });
    registry.route("tutor", "ungrounded");
    await expect(answerFromEvidence(new ProviderRuntime(registry, new MockModelClient()), "what", evidence, true, new AbortController().signal)).resolves.toContain("insufficient_evidence");
  });
});
