import { expect, it } from "vitest";
import { checkApiConnection } from "../src/api-connection.js";
import { apiConnectionInputSchema } from "../src/api-connection-config.js";
import { connectionIdentity } from "../src/api-connections.js";
import { createAgentModel } from "../src/agent-model-factory.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
const pi = new PiApplicationClient({ projectDir: "/unused", executable: "/unused/node", worker: "/unused/worker", sdk: "/unused/sdk" });
it.each(["openai-chat-completions", "anthropic-messages", "openai-responses"] as const)("checks a real %s adapter's two-request tool wire and explicit response model without inventing usage", async protocol => {
  const input = apiConnectionInputSchema.parse({ name: "fixture", protocol, baseUrl: "https://fixture.example/v1", model: "configured-fixture", tools: true });
  const connection = { ...input, id: connectionIdentity(input) }, secrets = new MemorySecretStore(); await secrets.set(`keychain:zhixing/${connection.id}`, "synthetic-fixture-key");
  let calls = 0;
  const client = createAgentModel(connection.id, { pi, connection, secrets, environment: {}, fetcher: async (_url, init) => {
    const body = JSON.parse(String(init.body)), first = calls++ === 0;
    const payload = first ? undefined : protocol === "openai-chat-completions" ? body.messages.find((message: { role: string }) => message.role === "tool").content : protocol === "anthropic-messages" ? body.messages.at(-1).content[0].content : body.input.find((item: { type: string }) => item.type === "function_call_output").output;
    const nonce = first ? "" : JSON.parse(payload).nonce; if (!first) expect(nonce).toMatch(/^[a-f0-9-]{36}$/);
    const response = protocol === "openai-chat-completions" ? { model: "reported-fixture", choices: [{ message: first ? { content: null, tool_calls: [{ id: "a", type: "function", function: { name: "zhixing_connection_probe", arguments: "{}" } }] } : { content: nonce }, finish_reason: first ? "tool_calls" : "stop" }] }
      : protocol === "anthropic-messages" ? { type: "message", model: "reported-fixture", content: first ? [{ type: "tool_use", id: "a", name: "zhixing_connection_probe", input: {} }] : [{ type: "text", text: nonce }], stop_reason: first ? "tool_use" : "end_turn" }
        : { object: "response", model: "reported-fixture", status: "completed", output: first ? [{ type: "function_call", id: "item", call_id: "a", name: "zhixing_connection_probe", arguments: "{}" }] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: nonce }] }] };
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  } });
  const result = await checkApiConnection(client, { mode: "tools" });
  expect(calls).toBe(2); expect(result.capabilityEvidence).toMatchObject({ requestedModel: "configured-fixture", reportedModel: "reported-fixture", modelSource: "provider_reported", requests: 2, observed: { tools: "roundtrip_confirmed" } });
});
it("does not turn a configured usage model into a provider identity claim", async () => {
  const result = await checkApiConnection({ async *stream() { yield { type: "text_delta", text: "connected" }; yield { type: "usage", usage: { model: "configured-only", inputTokens: 10, outputTokens: 1 } }; yield { type: "done" }; } });
  expect(result.capabilityEvidence).toMatchObject({ reportedModel: null, modelSource: "unreported" }); expect(result.model).toBeUndefined();
});
