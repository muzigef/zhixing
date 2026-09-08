import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod/v4";
import { topicIdSchema } from "./contracts.js";
import type { ZhixingDatabase } from "./database.js";

const safeText = z.string().max(4000).refine(text => !/[\0\r\n]|(?:api[_-]?key|token|password|secret)\s*[=:]|(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|\.ssh|\.codex)(?:[\\/]|$)/i.test(text));
const field = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
export const mcpReconcileSchema = z.object({ tool: z.string().min(1).max(128), argument: field, identity: field, resultIdentity: field, status: field, succeeded: z.string().min(1).max(80), notExecuted: z.string().min(1).max(80) }).strict().refine(value => value.succeeded !== value.notExecuted);
export const mcpServerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), enabled: z.boolean().default(false),
  consent: z.literal("local-process-and-topic-inputs"),
  command: safeText.refine(value => path.isAbsolute(value)), args: z.array(safeText).max(32).default([]),
  isolation: z.enum(["trusted", "restricted"]).optional(),
  readPaths: z.array(safeText.refine(value => path.isAbsolute(value))).max(8).optional(),
  tools: z.array(z.object({ name: z.string().min(1).max(128), risk: z.enum(["read", "write"]), replaySafe: z.boolean().default(false), reconcile: mcpReconcileSchema.optional() }).strict().refine(tool => (tool.risk === "read" || !tool.replaySafe) && (!tool.reconcile || tool.risk === "write"))).max(20),
}).strict().refine(server => new Set(server.tools.map(tool => tool.name)).size === server.tools.length);
export type McpServer = z.infer<typeof mcpServerSchema>;
const settingsSchema = z.object({ revision: z.number().int().nonnegative(), servers: z.array(mcpServerSchema).max(4) });
export type McpConfiguration = z.infer<typeof settingsSchema>;
export class McpSettings {
  constructor(private readonly database: ZhixingDatabase) { database.db.exec("CREATE TABLE IF NOT EXISTS mcp_settings(topic TEXT PRIMARY KEY,value TEXT NOT NULL)"); }
  read(topic: string): McpConfiguration {
    topicIdSchema.parse(topic); const row = this.database.db.prepare("SELECT value FROM mcp_settings WHERE topic=?").get(topic) as { value: string } | undefined;
    return row ? settingsSchema.parse(JSON.parse(row.value)) : { revision: 0, servers: [] };
  }
  replace(topic: string, expected: number, servers: unknown): McpConfiguration {
    const value = settingsSchema.parse({ revision: expected + 1, servers });
    if (value.servers.some(server => server.tools.some(tool => tool.reconcile && !server.tools.some(read => read.name === tool.reconcile!.tool && read.risk === "read" && read.replaySafe)))) throw new Error("mcp_reconciliation_invalid");
    if (new Set(value.servers.map(server => server.id)).size !== value.servers.length || JSON.stringify(value).length > 32_000) throw new Error("mcp_settings_invalid");
    return this.database.db.transaction(() => {
      if (this.read(topic).revision !== expected) throw new Error("mcp_settings_conflict");
      this.database.db.prepare("INSERT INTO mcp_settings VALUES (?,?) ON CONFLICT(topic) DO UPDATE SET value=excluded.value").run(topic, JSON.stringify(value)); return value;
    })();
  }
  static revokeAll(database: ZhixingDatabase): void {
    if (!database.db.prepare("SELECT name FROM sqlite_master WHERE name='mcp_settings'").get()) return;
    const settings = new McpSettings(database);
    for (const row of database.db.prepare("SELECT topic FROM mcp_settings").all() as { topic: string }[]) { const value = settings.read(row.topic); settings.replace(row.topic, value.revision, value.servers.map(server => ({ ...server, enabled: false }))); }
  }
}
/** Bind restored calls/approvals to this exact connection, policy and schema. */
export function mcpAlias(server: McpServer, name: string, schema: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify([server, name, schema])).digest("hex").slice(0, 16);
  return `mcp_${server.id}_${name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 16)}_${digest}`;
}
