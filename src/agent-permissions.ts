import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { LearningApplication } from "./learning-application.js";
import { McpSettings } from "./mcp-settings.js";

export const accessSelectionSchema = z.object({ materials: z.boolean(), project: z.boolean(), external: z.boolean() }).strict();
export type AccessSelection = z.infer<typeof accessSelectionSchema>;
export const permissionSchema = z.object({ version: z.literal(1), materials: z.boolean(), projectId: z.string().uuid().optional(), externalRevision: z.number().int().nonnegative().optional() }).strict();
export type AgentPermissions = z.infer<typeof permissionSchema>;
export const writeGrantSchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(["learning", "project", "external"]), label: z.string().max(500) }).strict();
export type WriteGrant = z.infer<typeof writeGrantSchema>;
export function accessSelection(permissions: AgentPermissions): AccessSelection { return { materials: permissions.materials, project: Boolean(permissions.projectId), external: permissions.externalRevision !== undefined }; }
/** The host binds access to resources; model arguments never carry permission. */
export function bindPermissions(app: LearningApplication, topic: string, selection: AccessSelection, previous?: AgentPermissions): AgentPermissions {
  accessSelectionSchema.parse(selection);
  const projectId = selection.project ? app.projects.selected(topic) ?? undefined : undefined;
  const external = selection.external ? new McpSettings(app.database).read(topic) : undefined;
  if (previous && (selection.project && previous.projectId && previous.projectId !== projectId || selection.external && previous.externalRevision !== undefined && previous.externalRevision !== external?.revision)) throw new Error("permission_scope_changed");
  if (selection.project && !projectId) throw new Error("project_selection_required");
  if (selection.external && !external?.servers.some(server => server.enabled)) throw new Error("mcp_permission_unavailable");
  return { version: 1, materials: selection.materials, projectId, externalRevision: external?.revision };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function writePermission(tool: string, input: unknown, topic: string): WriteGrant {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = tool.startsWith("mcp_") ? "external" : tool.startsWith("project_") ? "project" : "learning";
  const paths = Array.isArray(args.files) ? args.files.map(file => (file as { path?: string }).path).sort() : undefined;
  const operations = Array.isArray(args.files) ? args.files.map(file => ({ path: (file as { path?: string }).path, operation: (file as { content?: unknown }).content === null ? "delete" : "write" })).sort((a, b) => String(a.path).localeCompare(String(b.path))) : undefined;
  const target = kind === "external" ? canonical(args) : kind === "project" ? { projectId: args.projectId, path: args.path, operations, snapshotId: args.snapshotId } : { dayId: args.dayId, kind: args.kind };
  const label = kind === "external" ? "本会话中，此版本外部工具的相同参数" : kind === "project" ? `本会话当前项目：${args.path ?? paths?.join("、") ?? tool}` : `本会话当前主题：${args.dayId ?? ""} ${args.kind ?? tool}`;
  return { kind, label: label.slice(0, 500), key: createHash("sha256").update(JSON.stringify([kind, topic, tool, target])).digest("hex") };
}
export function retainGrants(grants: WriteGrant[] | undefined, before: AgentPermissions | undefined, after: AgentPermissions): WriteGrant[] {
  return (grants ?? []).filter(grant => grant.kind === "learning" ? after.materials : grant.kind === "project" ? Boolean(after.projectId) && after.projectId === before?.projectId : after.externalRevision !== undefined && after.externalRevision === before?.externalRevision);
}
