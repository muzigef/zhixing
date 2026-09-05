import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLearningTools, runLearningAgent } from "../src/learning-agent.js";
import { MockModelClient, type ContinuableModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

function services() {
  const observed: string[] = [];
  return {
    observed,
    progress: async (topic: string) => { observed.push(topic); return "尚未开始"; },
    list: (topic: string) => { observed.push(topic); return [{ name: "notes", status: "indexed" }]; },
    search: (topic: string) => {
      observed.push(topic);
      return [{ text: "evidence", score: 1, citation: { topicId: topic, documentId: "doc", documentName: "notes", anchor: "intro", pageNumber: null } }];
    },
  };
}
describe("learning agent control plane", () => {
  it("does not advertise or execute material search without consent", async () => {
    const tools = createLearningTools(services(), false);
    expect(tools.definitions.map((tool) => tool.name)).not.toContain("search_materials");
    await expect(tools.harness.execute("search_materials", { query: "x" }, { topicId: "rag", signal: new AbortController().signal })).resolves.toMatchObject({ ok: false, errorCode: "tool_not_allowed" });
  });
  it("binds all reads to the topic from the control plane", async () => {
    const data = services(); const tools = createLearningTools(data, true);
    const context = { topicId: "rag", signal: new AbortController().signal };
    await expect(tools.harness.execute("search_materials", { query: "x", topicId: "other" }, context)).resolves.toMatchObject({ ok: false });
    expect(data.observed).toEqual([]);
    await expect(tools.harness.execute("search_materials", { query: "x" }, context)).resolves.toMatchObject({ ok: true, output: [{ citation: { topicId: "rag" } }] });
    expect(data.observed).toEqual(["rag"]);
  });
  it("feeds tool errors back for recovery without granting write capability", async () => {
    const tools = createLearningTools(services(), false);
    let wrote = false;
    tools.harness.register({ name: "write", input: z.object({}), risk: "write", timeoutMs: 100, idempotent: false, execute: async () => { wrote = true; } });
    const seen: unknown[] = [];
    const client: ContinuableModelClient = {
      async *stream() { yield { type: "tool_call", tool: "write", input: {}, callId: "denied" }; },
      async *continue(_prompt, results) { seen.push(results[0]?.result); yield { type: "text_delta", text: "write denied; use explicit command" }; },
    };
    const registry = new ProviderRegistry(); registry.register({ id: "test", client, health: async () => "healthy" }); registry.route("tutor", "test");
    const result = await runLearningAgent(new ProviderRuntime(registry, new MockModelClient()), tools, { topicId: "rag", question: "help", confirmed: true }, new AbortController().signal);
    expect(result.text).toContain("write denied");
    expect(wrote).toBe(false);
    expect(seen).toEqual([{ ok: false, errorCode: "tool_not_allowed" }]);
  });
});
