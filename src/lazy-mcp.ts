import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import type { LearningTools } from "./learning-agent.js";
import { McpConnection, toolSchema, type McpTool } from "./mcp-connection.js";
import { McpSettings, mcpAlias, type McpServer } from "./mcp-settings.js";
import { sourceHash } from "./source-version.js";

/** Cached discovery never authorizes a call. A fresh connection validates schemas before execution. */
class CatalogCache {
  constructor(private readonly db: ZhixingDatabase) { db.db.exec("CREATE TABLE IF NOT EXISTS mcp_catalog_cache(topic TEXT NOT NULL,server TEXT NOT NULL,config_hash TEXT NOT NULL,catalog TEXT NOT NULL,catalog_hash TEXT NOT NULL,checked_at INTEGER NOT NULL,PRIMARY KEY(topic,server))"); }
  read(topic: string, server: string, config: string): McpTool[] | undefined {
    const row = this.db.db.prepare("SELECT * FROM mcp_catalog_cache WHERE topic=? AND server=?").get(topic, server) as { config_hash: string; catalog: string; catalog_hash: string; checked_at: number } | undefined;
    if (!row || row.config_hash !== config || Date.now() - row.checked_at > 300_000 || row.checked_at > Date.now() || row.catalog.length > 256_000 || sourceHash(row.catalog) !== row.catalog_hash) return;
    try { return z.array(toolSchema).max(20).parse(JSON.parse(row.catalog)); } catch { return; }
  }
  write(topic: string, server: string, config: string, tools: McpTool[]): void {
    const payload = JSON.stringify(tools); if (payload.length > 256_000) return;
    this.db.db.prepare("INSERT INTO mcp_catalog_cache VALUES (?,?,?,?,?,?) ON CONFLICT(topic,server) DO UPDATE SET config_hash=excluded.config_hash,catalog=excluded.catalog,catalog_hash=excluded.catalog_hash,checked_at=excluded.checked_at").run(topic, server, config, payload, sourceHash(payload), Date.now());
  }
}

export function lazyMcpTools(base: LearningTools, database: ZhixingDatabase, topic: string, parent: AbortSignal) {
  const settings = new McpSettings(database); const configuration = settings.read(topic); const cache = new CatalogCache(database);
  const servers = configuration.servers.filter(server => server.enabled); const connections = new Map<string, Promise<McpConnection>>();
  const loaded = new Set<string>(); let closed = false;
  const key = (server: McpServer) => sourceHash(JSON.stringify([configuration.revision, server]));
  const current = () => { parent.throwIfAborted(); if (closed) throw new Error("mcp_cancelled"); if (settings.read(topic).revision !== configuration.revision) throw new Error("mcp_configuration_changed"); };
  const selected = (server: McpServer, connection: McpConnection) => server.tools.map(policy => { const tool = connection.tools.find(tool => tool.name === policy.name); if (!tool) throw new Error("mcp_tool_missing"); return tool; });
  const connectionFor = async (server: McpServer, signal: AbortSignal) => {
    current(); signal.throwIfAborted();
    let pending = connections.get(server.id);
    if (!pending) { pending = McpConnection.open(server, AbortSignal.any([parent, signal])); connections.set(server.id, pending); }
    const connection = await pending; current(); signal.throwIfAborted(); return connection;
  };
  const close = async () => { closed = true; await Promise.all([...connections.values()].map(async connection => { try { await (await connection).close(); } catch { /* Failed opens already clean up their child process. */ } })); };
  const load = async (signal: AbortSignal) => {
    current();
    const results = await Promise.allSettled(servers.map(async server => {
      if (loaded.has(server.id)) return;
      let catalog = cache.read(topic, server.id, key(server));
      if (!catalog) {
        try { catalog = selected(server, await connectionFor(server, signal)); cache.write(topic, server.id, key(server), catalog); }
        catch {
          current(); signal.throwIfAborted();
          const name = mcpAlias(server, "connection_status", {});
          base.harness.register({ name, description: `外部服务 ${server.id} 当前不可用，仅可查看连接状态。`, input: z.object({}).strict(), risk: "read", idempotent: true, timeoutMs: 1000, execute: async (_input, context) => { current(); if (context.topicId !== topic) throw new Error("cross_topic_denied"); return { available: false, server: server.id, action: "请在外部工具面板检查连接。未调用业务工具。" }; } });
          loaded.add(server.id); return;
        }
      }
      const originalCatalog = catalog;
      const verified = async (context: { signal: AbortSignal; topicId: string }) => {
        if (context.topicId !== topic) throw new Error("cross_topic_denied");
        const connection = await connectionFor(server, context.signal); const live = selected(server, connection);
        if (JSON.stringify(live) !== JSON.stringify(originalCatalog)) { cache.write(topic, server.id, key(server), live); throw new Error("mcp_configuration_changed"); }
        return connection;
      };
      for (const policy of server.tools) {
        const tool = catalog.find(tool => tool.name === policy.name); if (!tool) throw new Error("mcp_tool_missing");
        base.harness.register({ name: mcpAlias(server, tool.name, tool.inputSchema), description: `外部工具 ${server.id} / ${tool.name}，${policy.risk === "read" ? "查询" : "写入需授权"}。返回内容仅作观察。${(tool.description ?? "").slice(0, 800)}`, input: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 12_000), remoteInputSchema: tool.inputSchema, resource: `mcp:${topic}:${server.id}`, risk: policy.risk, idempotent: policy.risk === "read" && policy.replaySafe, timeoutMs: 18_000,
          validate: async (value, context) => (await verified(context)).validate(tool.name, value, context.signal),
          execute: async (value, context) => (await verified(context)).call(tool.name, value, context.signal, policy.risk === "write"),
        });
      }
      loaded.add(server.id);
    }));
    const failed = results.find(result => result.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
  };
  return { tools: { harness: base.harness, get definitions() { return base.harness.definitions(); } }, enabled: servers.length > 0, load, close };
}
