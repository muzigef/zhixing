import { expect, it } from "vitest";
import { checkApiConnection } from "../src/api-connection.js";
import { adapterCapabilities } from "../src/model-capabilities.js";
import type { ContinuableModelClient, ModelClient, ModelRequestOptions } from "../src/model.js";
it("records text-only evidence without claiming tool, image, context or server output-limit validation", async () => {
  const client: ModelClient = { identity: { provider: "mock", model: "configured-model", connection: "fixture" }, capabilities: adapterCapabilities(true, "configurable"), async *stream() { yield { type: "text_delta", text: "连接正常" }; yield { type: "usage", usage: { inputTokens: 3, outputTokens: 2, model: "configured-model" } }; yield { type: "done", reportedModel: "reported-model" }; } };
  const result = await checkApiConnection(client);
  expect(result.capabilityEvidence).toMatchObject({ version: 1, requestedModel: "configured-model", reportedModel: "reported-model", observed: { text: "confirmed", tools: "not_tested", images: "not_tested", contextLimit: "not_tested", outputLimit: "requested_not_verified" }, policy: { source: "adapter_policy" } });
  expect(result.firstBodyMs).toBe(result.firstTokenMs);
});
it("proves a bounded synthetic tool roundtrip without invoking application tools or altering declared policy", async () => {
  let responseToken = "", optionsSeen: ModelRequestOptions | undefined, continued = 0;
  const client: ContinuableModelClient = { capabilities: adapterCapabilities(true, "configurable"), async *stream(_prompt, _signal, options) {
    optionsSeen = options;
    yield { type: "tool_call", tool: "zhixing_connection_probe", input: {}, callId: "probe-call" }; yield { type: "done" };
  }, async *continue(_prompt, results, _signal, options) {
    continued++; expect(options?.history).toHaveLength(1);
    responseToken = (results[0]!.result as { nonce: string }).nonce;
    yield { type: "text_delta", text: `合成工具返回 ${responseToken}` }; yield { type: "done" };
  } };
  const result = await checkApiConnection(client, { mode: "tools" });
  expect(continued).toBe(1); expect(optionsSeen?.tools?.map(tool => tool.name)).toEqual(["zhixing_connection_probe"]);
  expect(result.capabilityEvidence.observed.tools).toBe("roundtrip_confirmed");
  expect(JSON.stringify(result)).not.toContain(responseToken);
  expect(client.capabilities?.source).toBe("adapter_policy");
});
it("marks a declined tool call inconclusive and refuses undeclared tools before any real transport", async () => {
  let calls = 0;
  const client: ModelClient = { capabilities: adapterCapabilities(false), async *stream() { calls++; yield { type: "done" }; } };
  await expect(checkApiConnection(client, { mode: "tools" })).rejects.toThrow("provider_tools_unsupported"); expect(calls).toBe(0);
  const declined: ContinuableModelClient = { capabilities: adapterCapabilities(true), async *stream() { yield { type: "text_delta", text: "不调用工具" }; yield { type: "done" }; }, async *continue() { yield { type: "done" }; throw new Error("must not run"); } };
  expect((await checkApiConnection(declined, { mode: "tools" })).capabilityEvidence.observed.tools).toBe("inconclusive");
});
it("rejects extra tool calls, wrong tool names and unmatched tool-result acknowledgements", async () => {
  for (const variant of ["wrong-tool", "two-tools", "bad-ack"]) {
    const client: ContinuableModelClient = { capabilities: adapterCapabilities(true), async *stream() { yield { type: "tool_call", tool: variant === "wrong-tool" ? "read_file" : "zhixing_connection_probe", input: {}, callId: "a" }; if (variant === "two-tools") yield { type: "tool_call", tool: "zhixing_connection_probe", input: {}, callId: "b" }; yield { type: "done" }; }, async *continue() { yield { type: "text_delta", text: "未使用返回值" }; yield { type: "done" }; } };
    if (variant === "bad-ack") expect((await checkApiConnection(client, { mode: "tools" })).capabilityEvidence.observed.tools).toBe("inconclusive");
    else await expect(checkApiConnection(client, { mode: "tools" })).rejects.toThrow("provider_protocol_error");
  }
});
