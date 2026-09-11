import { expect, it, vi } from "vitest";
import { providerCatalog, providerTemplate } from "../src/provider-catalog.js";
import { apiConnectionInputSchema } from "../src/api-connection-config.js";
import { connectionIdentity } from "../src/api-connections.js";
import { createAgentModel } from "../src/agent-model-factory.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import type { ModelEvent, ModelRequestOptions } from "../src/model.js";

const pi = new PiApplicationClient({ projectDir: "/unused", executable: "/unused/node", worker: "/unused/worker", sdk: "/unused/sdk" });
const signal = () => new AbortController().signal;
const collect = async (stream: AsyncIterable<ModelEvent>) => { const events: ModelEvent[] = []; for await (const event of stream) events.push(event); return events; };
const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const message = (content: unknown[] = [{ type: "text", text: "合成回答" }], stop_reason = "end_turn") => ({ type: "message", role: "assistant", content, stop_reason, usage: { input_tokens: 12, output_tokens: 7 } });
const response = (output: unknown[] = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "合成回答" }] }], status = "completed") => ({ id: "resp-fixture", status, output, usage: { input_tokens: 12, output_tokens: 7 } });
async function setup(protocol: "anthropic-messages" | "openai-responses", outputs: Response[], overrides = {}) {
  const input = apiConnectionInputSchema.parse({ name: "测试", protocol, baseUrl: "https://api.example/v1", model: "fixture-model", ...overrides });
  const connection = { ...input, id: connectionIdentity(input) }; const secrets = new MemorySecretStore();
  await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-only");
  const fetcher = vi.fn(async () => outputs.shift()!);
  const client = createAgentModel(connection.id, { pi, connection, secrets, fetcher, environment: {} });
  return { client, fetcher, connection };
}
it("provides ten distinct providers and validated protocol templates without pretending keys are subscriptions", () => {
  expect(new Set(providerCatalog.map(p => p.id)).size).toBe(10);
  for (const provider of providerCatalog) {
    const draft = providerTemplate(provider.id);
    expect(apiConnectionInputSchema.safeParse({ ...draft, baseUrl: draft.baseUrl || "https://workspace.example/v1", model: "chosen-model" }).success).toBe(true);
    expect(provider.documentation).toMatch(/^https:\/\//);
  }
  expect(providerCatalog.find(p => p.id === "openai")?.accountNote).toContain("独立");
  expect(providerTemplate("anthropic").protocol).toBe("anthropic-messages");
  expect(() => providerTemplate("unknown")).toThrow("provider_not_found");
});
it.each(["anthropic-messages", "openai-responses"] as const)("routes %s with role-aware history, bounded output and no redirects", async protocol => {
  const { client, fetcher } = await setup(protocol, [new Response(JSON.stringify(protocol === "anthropic-messages" ? message() : response()))]);
  const events = await collect(client.stream("fallback", signal(), { messages: [{ role: "system", content: "教学规则" }, { role: "assistant", content: "历史回答" }, { role: "observation", content: "引用" }, { role: "user", content: "本轮" }], maxOutputTokens: 512 }));
  expect(events).toContainEqual({ type: "done" }); expect(events).toContainEqual({ type: "text_delta", text: "合成回答" });
  expect(events.find(e => e.type === "usage")?.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 });
  const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(url).toBe(`https://api.example/v1/${protocol === "anthropic-messages" ? "messages" : "responses"}`);
  expect(init.redirect).toBe("error");
  const body = JSON.parse(String(init.body));
  expect(body[protocol === "anthropic-messages" ? "max_tokens" : "max_output_tokens"]).toBe(512);
  expect(JSON.stringify(body)).toContain("历史回答"); expect(JSON.stringify(body)).not.toContain("fallback");
  if (protocol === "anthropic-messages") { expect(body.system).toBe("教学规则"); expect(init.headers).toMatchObject({ "x-api-key": "fixture-only", "anthropic-version": "2023-06-01" }); }
  else expect(body.store).toBe(false);
});
it("preserves Anthropic signed thinking and tool IDs through continuation", async () => {
  const blocks = [{ type: "thinking", thinking: "private-fixture", signature: "opaque-signature" }, { type: "tool_use", id: "tool-1", name: "lookup", input: { q: "synthetic" } }];
  const { client, fetcher } = await setup("anthropic-messages", [new Response(JSON.stringify(message(blocks, "tool_use"))), new Response(JSON.stringify(message()))]);
  const events = await collect(client.stream("问题", signal()));
  expect(events.some(e => e.type === "text_delta" && e.text?.includes("private-fixture"))).toBe(false);
  const options: ModelRequestOptions = { history: [{ events, toolResults: [{ callId: "tool-1", tool: "lookup", result: { answer: "evidence" } }] }] };
  await collect(client.stream("问题", signal(), options));
  const body = JSON.parse(String((fetcher.mock.calls as unknown as [string, RequestInit][])[1]![1].body));
  expect(body.messages[1].content).toEqual(blocks);
  expect(body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tool-1" });
  await expect(collect(client.stream("问题", signal(), { history: [{ events, toolResults: [] }] }))).rejects.toThrow("provider_protocol_error");
});
it("preserves Responses encrypted reasoning and uses function call_id rather than item id", async () => {
  const output = [{ type: "reasoning", id: "rs-1", encrypted_content: "opaque", summary: [] }, { type: "function_call", id: "fc-item", call_id: "call-1", name: "lookup", arguments: "{}" }];
  const { client, fetcher } = await setup("openai-responses", [new Response(JSON.stringify(response(output))), new Response(JSON.stringify(response()))]);
  const events = await collect(client.stream("问题", signal()));
  expect(events).toContainEqual({ type: "tool_call", callId: "call-1", tool: "lookup", input: {} });
  await collect(client.stream("问题", signal(), { history: [{ events, toolResults: [{ callId: "call-1", tool: "lookup", result: "answer" }] }] }));
  const body = JSON.parse(String((fetcher.mock.calls as unknown as [string, RequestInit][])[1]![1].body));
  expect(body.input).toContainEqual(output[0]); expect(body.input).toContainEqual({ type: "function_call_output", call_id: "call-1", output: '"answer"' });
  expect(body.include).toContain("reasoning.encrypted_content"); expect(body).not.toHaveProperty("previous_response_id");
});
it("streams Anthropic text, retains cumulative usage and rejects truncated tool batches", async () => {
  const frames = [{ type: "message_start", message: message([]) }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } }, { type: "message_stop" }];
  const { client } = await setup("anthropic-messages", [sse(frames)]);
  const events = await collect(client.stream("问题", signal()));
  expect(events.filter(e => e.type === "text_delta").map(e => e.text).join("")).toBe("你好");
  expect(events.find(e => e.type === "usage")?.usage?.outputTokens).toBe(9);
  const bad = await setup("anthropic-messages", [sse(frames.slice(0, -1))]);
  await expect(collect(bad.client.stream("问题", signal()))).rejects.toThrow("provider_incomplete");
});
it("streams Responses deltas exactly once and requires a completed response", async () => {
  const { client } = await setup("openai-responses", [sse([{ type: "response.output_text.delta", delta: "合成回答" }, { type: "response.completed", response: response() }])]);
  expect((await collect(client.stream("问题", signal()))).filter(e => e.type === "text_delta").map(e => e.text).join("")).toBe("合成回答");
});
it("retains reported usage from a failed Responses event without accepting its output", async () => {
  const { client } = await setup("openai-responses", [sse([{ type: "response.failed", response: response([], "failed") }])]);
  const events: ModelEvent[] = [];
  await expect((async () => { for await (const event of client.stream("合成", signal())) events.push(event); })()).rejects.toThrow("provider_protocol_error");
  expect(events).toEqual([{ type: "usage", usage: { inputTokens: 12, outputTokens: 7, model: "fixture-model" } }]);
});
it.each(["anthropic-messages", "openai-responses"] as const)("%s sanitizes credential-store failures during preflight", async protocol => {
  const { connection } = await setup(protocol, []);
  const secrets = { get: async () => { throw new Error("private fixture from credential provider"); }, set: async () => {}, delete: async () => false };
  const fetcher = vi.fn(async () => new Response());
  const client = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: {} });
  await expect(client.prepare!(signal())).rejects.toThrow(/^secret_store_unavailable$/);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["anthropic-messages", "openai-responses"] as const)("%s refuses truncation, invalid tools, credential leaks and live calls when disabled", async protocol => {
  const bad = protocol === "anthropic-messages" ? message([{ type: "tool_use", id: "x", name: "lookup", input: {} }], "max_tokens") : response([{ type: "function_call", call_id: "x", name: "lookup", arguments: "{}" }], "incomplete");
  const { client, connection } = await setup(protocol, [new Response(JSON.stringify(bad))]);
  const seen: ModelEvent[] = [];
  await expect((async () => { for await (const e of client.stream("问题", signal())) seen.push(e); })()).rejects.toThrow("provider_incomplete");
  expect(seen.some(e => e.type === "tool_call" || e.type === "done")).toBe(false);
  const fetcher = vi.fn(async () => { throw new Error("Authorization fixture-only"); });
  const secrets = { get: async () => "fixture-only", set: async () => {}, delete: async () => false };
  const disabled = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: { ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
  await expect(collect(disabled.stream("问题", signal()))).rejects.toThrow("live_provider_disabled"); expect(fetcher).not.toHaveBeenCalled();
  const broken = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: {} });
  await expect(collect(broken.stream("问题", signal()))).rejects.toThrow(/^provider_unavailable$/);
});

it("preserves Gemini thought signatures across streamed tool continuation without forwarding arbitrary extras", async () => {
  const input = apiConnectionInputSchema.parse({ name: "Gemini", baseUrl: "https://gemini.example/v1", model: "gemini-fixture" });
  const connection = { ...input, id: connectionIdentity(input) };
  const secret = new MemorySecretStore(); await secret.set(`keychain:zhixing/${connection.id}`, "fixture");
  const requests: RequestInit[] = [];
  const client = createAgentModel(connection.id, { pi, connection, secrets: secret, environment: {}, fetcher: async (_url, init) => {
    requests.push(init);
    if (requests.length > 1) return new Response(JSON.stringify({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] }));
    const data = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-g", function: { name: "lookup", arguments: "{}" }, extra_content: { google: { thought_signature: "opaque-g" }, untrusted: "drop-me" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ];
    return new Response(data.map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const events = await collect(client.stream("问题", signal()));
  await collect(client.stream("问题", signal(), { history: [{ events, toolResults: [{ tool: "lookup", callId: "call-g", result: "synthetic" }] }] }));
  const body = JSON.parse(String(requests[1]!.body));
  expect(body.messages[1].tool_calls[0].extra_content).toEqual({ google: { thought_signature: "opaque-g" } });
  expect(JSON.stringify(body)).not.toContain("drop-me");
});

it.each(["anthropic-messages", "openai-responses"] as const)("%s cancels pending I/O, refuses duplicate tools and preserves billable usage on failure", async protocol => {
  const payload = protocol === "anthropic-messages" ? message([{ type: "tool_use", id: "duplicate", name: "lookup", input: {} }, { type: "tool_use", id: "duplicate", name: "lookup", input: {} }], "tool_use") : response([{ type: "function_call", call_id: "duplicate", name: "lookup", arguments: "{}" }, { type: "function_call", call_id: "duplicate", name: "lookup", arguments: "{}" }]);
  const { client, connection } = await setup(protocol, [new Response(JSON.stringify(payload))]);
  const events: ModelEvent[] = [];
  await expect((async () => { for await (const event of client.stream("合成", signal())) events.push(event); })()).rejects.toThrow("provider_protocol_error");
  expect(events.some(e => e.type === "tool_call" || e.type === "done")).toBe(false); expect(events.find(e => e.type === "usage")?.usage?.outputTokens).toBe(7);
  const secrets = new MemorySecretStore(); await secrets.set(`keychain:zhixing/${connection.id}`, "fixture");
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const stalled = createAgentModel(connection.id, { pi, secrets, connection, environment: {}, fetcher: async () => { started(); return new Promise<Response>(() => {}); } });
  const controller = new AbortController(); const pending = collect(stalled.stream("合成", controller.signal));
  await ready; controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it.each(["openai-chat-completions", "openai-responses", "anthropic-messages"] as const)("supports an uncatalogued provider through shared conversation history using %s", async protocol => {
  const { AgentService } = await import("../src/agent-service.js");
  const { AgentSessionStore } = await import("../src/agent-session-store.js");
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uncatalogued-provider-"));
  const input = apiConnectionInputSchema.parse({ name: "第十一家合成服务", protocol, baseUrl: "https://future-vendor.example/v1", model: "future-text-model", tools: false });
  const connection = { ...input, id: connectionIdentity(input) }, secrets = new MemorySecretStore();
  await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-only");
  const requests: RequestInit[] = [];
  const client = createAgentModel(connection.id, { pi, secrets, connection, environment: {}, fetcher: async (_url, init) => {
    requests.push(init);
    return new Response(JSON.stringify(protocol === "anthropic-messages" ? message() : protocol === "openai-responses" ? response() : { choices: [{ message: { content: "合成回答" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 7 } }));
  } });
  const store = new AgentSessionStore(root), service = new AgentService(store, () => client);
  try {
    const session = await service.create();
    await service.invoke({ sessionId: session.id, provider: connection.id, style: "adaptive", text: "第一次合成问题" });
    await service.pauseMaintenance();
    await service.invoke({ sessionId: session.id, provider: connection.id, style: "adaptive", text: "第二次合成问题" });
    expect((await store.load(session.id)).messages.at(-1)?.status).toBe("completed");
    expect(String(requests.at(-1)?.body)).toContain("第一次合成问题");
    expect(String(requests.at(-1)?.body)).toContain("第二次合成问题");
    expect(providerCatalog.some(provider => provider.baseUrl === connection.baseUrl)).toBe(false);
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
