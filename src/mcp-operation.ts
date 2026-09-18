import { createHash } from "node:crypto";
import type { McpServer } from "./mcp-settings.js";
import type { ToolExecutionContext } from "./tool-harness.js";
type Policy = McpServer["tools"][number];
export function mcpRequestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)).digest("hex");
}
/** Only configured services that accept a string operation key receive host-generated metadata. */
export function mcpOperationInput(policy: Policy, alias: string, value: Record<string, unknown>, context: ToolExecutionContext): Record<string, unknown> {
  const field = policy.idempotency?.argument; if (!field) return value;
  if (Object.hasOwn(value, field)) throw new Error("mcp_input_invalid");
  if (!context.executionId || !context.callId) throw new Error("mcp_operation_identity_missing");
  return { ...value, [field]: mcpRequestHash(["operation-v1", context.topicId, context.executionId, context.callId, alias]) };
}
export function publicMcpSchema(policy: Policy, schema: Record<string, unknown>): Record<string, unknown> {
  const field = policy.idempotency?.argument; if (!field) return schema;
  const properties = schema.properties as Record<string, { type?: string }> | undefined;
  if (!properties || properties[field]?.type !== "string") throw new Error("mcp_schema_unsupported");
  const visible = { ...properties }; delete visible[field];
  return { ...schema, properties: visible, ...(Array.isArray(schema.required) ? { required: schema.required.filter(name => name !== field) } : {}) };
}
