import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { apiConnectionInputSchema } from "../src/api-connection-config.js";
import { ApiConnections, connectionIdentity } from "../src/api-connections.js";
import { createAgentModel } from "../src/agent-model-factory.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { EncryptedDesktopSecrets } from "../desktop/core/secrets.js";
import type { ModelEvent } from "../src/model.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "api-connections-")); roots.push(root); return root; }
const input = () => apiConnectionInputSchema.parse({ name: "测试模型", baseUrl: "https://compatible.example/v1/", model: "vendor/model-1" });
const pi = new PiApplicationClient({ projectDir: "/unused", executable: "/unused/node", worker: "/unused/worker", sdk: "/unused/sdk" });
const response = (content = "连接正常") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
async function collect(events: AsyncIterable<ModelEvent>) { const result: ModelEvent[] = []; for await (const event of events) result.push(event); return result; }

it("validates protocol, credential-free endpoints, bounded capabilities and unknown fields", () => {
  expect(input().baseUrl).toBe("https://compatible.example/v1");
  for (const baseUrl of ["http://public.example/v1", "https://user:secret@example.org/v1", "https://example.org/v1?key=fixture", "https://example.org/v1#secret", "file:///tmp/socket", "https://example.org/v1/chat/completions"]) expect(apiConnectionInputSchema.safeParse({ ...input(), baseUrl }).success).toBe(false);
  expect(apiConnectionInputSchema.safeParse({ ...input(), baseUrl: "http://127.0.0.1:11434/v1" }).success).toBe(true);
  expect(apiConnectionInputSchema.safeParse({ ...input(), apiKey: "fixture-value" }).success).toBe(false);
  expect(apiConnectionInputSchema.safeParse({ ...input(), protocol: "unknown" }).success).toBe(false);
});

it("persists public connections, rejects stale writes and binds IDs to endpoint/model/options", async () => {
  const file = path.join(await directory(), "connections.json"); const store = new ApiConnections(file);
  const initial = await store.load(); const saved = await store.save(input(), initial.revision);
  const id = saved.connections[0]!.id;
  expect(id).toBe(connectionIdentity(input()));
  expect(connectionIdentity({ ...input(), name: "改名" })).toBe(id);
  expect(connectionIdentity({ ...input(), model: "another" })).not.toBe(id);
  await expect(store.save({ ...input(), name: "过期" }, 0)).rejects.toThrow("api_connections_conflict");
  const renamed = await store.save({ ...input(), name: "改名" }, 1);
  expect(renamed.connections).toHaveLength(1);
  expect((await new ApiConnections(file).load()).connections[0]!.name).toBe("改名");
  const corrupted = { ...renamed, connections: [{ ...renamed.connections[0], baseUrl: "https://elsewhere.example/v1" }] };
  await fs.writeFile(file, JSON.stringify(corrupted));
  await expect(store.load()).rejects.toThrow("api_connections_invalid");
});

it("serializes competing writes, removes only configuration and cannot accept arbitrary IDs", async () => {
  const store = new ApiConnections(path.join(await directory(), "connections.json"));
  const results = await Promise.allSettled([store.save(input(), 0), store.save({ ...input(), model: "other" }, 0)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const state = await store.load();
  expect((await store.remove(state.connections[0]!.id, state.revision)).connections).toEqual([]);
  expect(() => store.remove("../../private", 2)).toThrow();
});

it("encrypts custom credentials separately and restores them without exposing them in settings", async () => {
  const root = await directory(); const id = connectionIdentity(input()); const second = connectionIdentity({ ...input(), model: "second" });
  const cipher = { available: async () => true, encrypt: async (value: string) => Buffer.from([...value].reverse().join("")), decrypt: async (value: Buffer) => [...value.toString()].reverse().join("") };
  const first = new EncryptedDesktopSecrets(root, cipher, undefined, id);
  await first.set(`keychain:zhixing/${id}`, "fixture-custom-value");
  expect(await new EncryptedDesktopSecrets(root, cipher, undefined, id).status()).toMatchObject({ configured: true });
  expect(await new EncryptedDesktopSecrets(root, cipher, undefined, second).status()).toEqual({ configured: false });
  await expect(first.get(`keychain:zhixing/${second}`)).rejects.toThrow("invalid_secret_reference");
  expect((await fs.readFile(path.join(root, `${id}.credential`))).toString()).not.toContain("fixture-custom-value");
});

it("routes a new vendor by data, preserves limits and never redirects the API key", async () => {
  const connection = { ...input(), id: connectionIdentity(input()) }; const secrets = new MemorySecretStore();
  await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-custom-value");
  const fetcher = vi.fn(async () => response());
  const client = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: {} });
  expect(await collect(client.stream("测试", new AbortController().signal, { maxOutputTokens: 512 }))).toContainEqual({ type: "done" });
  const [url, request] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(url).toBe("https://compatible.example/v1/chat/completions"); expect(request.redirect).toBe("error");
  expect(JSON.parse(String(request.body))).toMatchObject({ model: "vendor/model-1", max_tokens: 512, stream: true });
  expect(JSON.parse(String(request.body))).not.toHaveProperty("thinking");
  expect(JSON.parse(String(request.body))).not.toHaveProperty("reasoning_effort");
  expect(() => createAgentModel(connection.id, { pi, secrets })).toThrow("provider_not_found");
  expect(() => createAgentModel(connection.id, { pi, secrets, connection: { ...connection, baseUrl: "https://evil.example/v1" } })).toThrow("api_connections_invalid");
});

it("enforces the live switch and sanitizes failures before keys or requests can escape", async () => {
  const connection = { ...input(), id: connectionIdentity(input()) }; const secrets = new MemorySecretStore();
  await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-custom-value");
  const fetcher = vi.fn(async () => { throw new Error("provider_unavailable: fixture-custom-value request details"); });
  const blocked = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: { ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
  await expect(collect(blocked.stream("测试", new AbortController().signal))).rejects.toThrow("live_provider_disabled"); expect(fetcher).not.toHaveBeenCalled();
  const failed = createAgentModel(connection.id, { pi, secrets, connection, fetcher, environment: {} });
  await expect(collect(failed.stream("测试", new AbortController().signal))).rejects.toThrow("provider_unavailable: compatible-api 请求或读取失败");
});

it("honors compatibility parameters and model capabilities, without sending foreign reasoning fields", async () => {
  const definition = { ...input(), tokenField: "max_completion_tokens" as const, reasoning: "openai" as const, tools: false, streamUsage: false, contextWindow: 8000, maxOutputTokens: 1024 };
  const connection = { ...definition, id: connectionIdentity(definition) }; const secrets = new MemorySecretStore(); await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-custom-value");
  const requests: Record<string, unknown>[] = [];
  const client = createAgentModel(connection.id, { pi, secrets, connection, environment: {}, contextBudget: { windowTokens: 48_000, reserveOutputTokens: 16_384 }, fetcher: async (_url, request) => { requests.push(JSON.parse(String(request.body))); return response(); } });
  expect(client.contextBudget).toEqual({ windowTokens: 8000, reserveOutputTokens: 1024 });
  expect(client.capabilities?.toolCalling).toBe(false);
  await collect(client.stream("测试", new AbortController().signal, { reasoning: "quick", messages: [{ role: "assistant", content: "上一轮" }, { role: "user", content: "继续" }] }));
  expect(requests[0]).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 1024 });
  for (const field of ["max_tokens", "thinking", "stream_options", "tools"]) expect(requests[0]).not.toHaveProperty(field);
  expect(JSON.stringify(requests[0])).not.toContain("reasoning_content");
  await expect(collect(client.stream("测试", new AbortController().signal, { tools: [{ name: "test", description: "test", inputSchema: {} }] }))).rejects.toThrow("provider_tools_unsupported");
});

it("rejects unfinished responses and never emits a tool request from a text-only connection", async () => {
  const definition = { ...input(), tools: false }; const connection = { ...definition, id: connectionIdentity(definition) };
  const secrets = new MemorySecretStore(); await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-custom-value");
  for (const payload of [{ choices: [{ message: { content: "未结束" } }] }, { choices: [{ message: { tool_calls: [{ id: "bad-call", function: { name: "test", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }]) {
    const client = createAgentModel(connection.id, { pi, secrets, connection, environment: {}, fetcher: async () => new Response(JSON.stringify(payload)) });
    const events: ModelEvent[] = [];
    await expect((async () => { for await (const event of client.stream("测试", new AbortController().signal)) events.push(event); })()).rejects.toThrow("provider_protocol_error");
    expect(events.some(event => event.type === "tool_call" || event.type === "done")).toBe(false);
  }
});

it("refuses actual HTTP redirects and cancels a pending custom request", async () => {
  let redirected = false;
  const server = createServer((request, response) => {
    if (request.url === "/leak") { redirected = true; response.end("unexpected"); }
    else { response.writeHead(307, { location: "/leak" }); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const definition = apiConnectionInputSchema.parse({ ...input(), baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` });
    const connection = { ...definition, id: connectionIdentity(definition) }; const secrets = new MemorySecretStore(); await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-custom-value");
    const client = createAgentModel(connection.id, { pi, secrets, connection, environment: {} });
    await expect(collect(client.stream("合成重定向", new AbortController().signal))).rejects.toThrow("provider_unavailable");
    expect(redirected).toBe(false);
    let requested: (() => void) | undefined; const started = new Promise<void>(resolve => { requested = resolve; });
    const controller = new AbortController();
    const stalled = createAgentModel(connection.id, { pi, secrets, connection, environment: {}, fetcher: async () => { requested!(); return new Promise<Response>(() => undefined); } });
    const pending = collect(stalled.stream("合成取消", controller.signal)); await started; controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
