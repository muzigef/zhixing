import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { McpSettings } from "../src/mcp-settings.js";
import { lazyMcpTools } from "../src/lazy-mcp.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-lazy-mcp-")); const app = await LearningApplication.open(path.join(root, "workspace"));
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const record = path.join(root, "calls.jsonl"); const schemaFile = path.join(root, "schema-limit.json"); await fs.writeFile(schemaFile, "200");
  const settings = new McpSettings(app.database);
  settings.replace("rag", 0, [{ id: "fixture", enabled: true, consent: "local-process-and-topic-inputs", command: process.execPath, args: [path.resolve("tests/fixtures/mcp-server.mjs"), "schema-file", record, schemaFile], tools: [{ name: "echo", risk: "read", replaySafe: true }] }]);
  return { root, app, record, settings, schemaFile };
}
it("starts no external process for an ordinary authorized question", async () => {
  const { root, app, record } = await fixture();
  const client = { async *stream() { yield { type: "text_delta" as const, text: "合成解释" }; yield { type: "done" as const }; }, async *continue() { yield* this.stream(); } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app); cleanup.push(async () => { await service.pauseMaintenance(); });
  const session = await service.create(); await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", topicId: "rag", contextAllowed: true, text: "解释什么是缓存" }); await service.idle();
  expect((await service.load(session.id)).messages.at(-1)?.status).toBe("completed");
  await expect(fs.stat(record)).rejects.toMatchObject({ code: "ENOENT" });
});
it("caches only the versioned catalog and connects on first actual validation", async () => {
  const { app, record } = await fixture(); const signal = new AbortController().signal;
  const first = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(first.close); await first.load(signal); await first.close();
  const before = await fs.readFile(record, "utf8");
  const second = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(second.close); await second.load(signal);
  expect(await fs.readFile(record, "utf8")).toBe(before);
  const name = second.tools.harness.definitions().find(tool => tool.name.startsWith("mcp_fixture_echo_"))!.name;
  expect(await second.tools.harness.execute(name, { text: "cached catalog, actual tool" }, { topicId: "rag", signal })).toMatchObject({ ok: true });
  const events = (await fs.readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(events.filter(event => event.method === "server/discover")).toHaveLength(2); expect(events.filter(event => event.method === "tools/call")).toHaveLength(1);
});
it("rejects catalog/schema drift before dispatching any business request", async () => {
  const { app, record, schemaFile } = await fixture(); const signal = new AbortController().signal;
  const first = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(first.close); await first.load(signal); await first.close();
  await fs.writeFile(schemaFile, "20");
  const next = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(next.close); await next.load(signal);
  const name = next.tools.harness.definitions().find(tool => tool.name.startsWith("mcp_fixture_echo_"))!.name;
  expect(await next.tools.harness.execute(name, { text: "synthetic" }, { topicId: "rag", signal })).toMatchObject({ ok: false, errorCode: "mcp_configuration_changed" });
  expect(await fs.readFile(record, "utf8")).not.toContain('"method":"tools/call"');
});
it("invalidates expired catalogs and blocks a revoked configuration without executing a tool", async () => {
  const { app, record, settings } = await fixture(); const signal = new AbortController().signal;
  const first = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(first.close); await first.load(signal); await first.close();
  app.database.db.prepare("UPDATE mcp_catalog_cache SET checked_at=?").run(Date.now() - 301_000);
  const next = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(next.close); await next.load(signal);
  expect((await fs.readFile(record, "utf8")).split("\n").filter(line => line.includes('"method":"server/discover"'))).toHaveLength(2);
  const name = next.tools.harness.definitions().find(tool => tool.name.startsWith("mcp_fixture_echo_"))!.name;
  const config = settings.read("rag"); settings.replace("rag", config.revision, config.servers.map(server => ({ ...server, enabled: false })));
  expect(await next.tools.harness.execute(name, { text: "denied" }, { topicId: "rag", signal })).toMatchObject({ ok: false, errorCode: "mcp_configuration_changed" });
  const disabled = lazyMcpTools(app.tools(true), app.database, "rag", signal); cleanup.push(disabled.close); await disabled.load(signal); expect(disabled.enabled).toBe(false);
  expect(await fs.readFile(record, "utf8")).not.toContain('"method":"tools/call"');
});
it("exposes semantic fallback in the context instead of silently treating it as a semantic match", async () => {
  const { app, root } = await fixture(); const file = path.join(root, "synthetic.md"); await fs.writeFile(file, "# 缓存\n\n检索缓存需要失效策略。");
  await app.importSelected("rag", file, new AbortController().signal); app.configureSemantic("synthetic");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  const result = await app.searchDetailed("rag", "缓存", new AbortController().signal);
  expect(result.evidence.length).toBeGreaterThan(0); expect(result.retrieval).toMatchObject({ mode: "lexical_fallback", reason: "semantic_unavailable" });
  expect((await app.context("rag", "缓存", true, new AbortController().signal)).text).toContain("lexical_fallback");
  const client = { async *stream() { yield { type: "text_delta" as const, text: "合成解释" }; yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app); cleanup.push(async () => { await service.pauseMaintenance(); });
  const session = await service.create(); await service.send({ sessionId: session.id, text: "缓存", provider: "mock", style: "adaptive", topicId: "rag", contextAllowed: true }); await service.idle();
  expect((await service.load(session.id)).messages.at(-1)?.activities).toContainEqual(expect.objectContaining({ label: "语义服务暂不可用，已使用关键词检索" }));
});
