import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mcpOperationInput, publicMcpSchema, mcpRequestHash } from "../src/mcp-operation.js";
it("keeps host operation keys stable on restart but separates tasks and forbids model keys", () => {
  const policy = { name: "write", risk: "write" as const, replaySafe: false, idempotency: { argument: "operationKey" } }, context = { topicId: "rag", executionId: randomUUID(), callId: "write-1", signal: new AbortController().signal };
  const first = mcpOperationInput(policy, "alias", { text: "synthetic" }, context);
  expect(first).toEqual(mcpOperationInput(policy, "alias", { text: "synthetic" }, context));
  expect(first.operationKey).not.toBe(mcpOperationInput(policy, "alias", { text: "synthetic" }, { ...context, executionId: randomUUID() }).operationKey);
  expect(() => mcpOperationInput(policy, "alias", { operationKey: "forged" }, context)).toThrow("mcp_input_invalid");
  expect(() => mcpOperationInput(policy, "alias", {}, { ...context, executionId: undefined })).toThrow("mcp_operation_identity_missing");
});
it("hides only the declared host field from model input and rejects unsupported contracts", () => {
  const policy = { name: "write", risk: "write" as const, replaySafe: false, idempotency: { argument: "operationKey" } };
  const schema = { type: "object", properties: { text: {type:"string"}, operationKey: {type:"string"} }, required: ["text", "operationKey"], additionalProperties:false };
  expect(publicMcpSchema(policy, schema)).toMatchObject({ properties: {text:{type:"string"}}, required:["text"] });
  expect(publicMcpSchema(policy, schema).properties).not.toHaveProperty("operationKey"); expect(schema.required).toHaveLength(2);
  expect(() => publicMcpSchema(policy, {type:"object"})).toThrow("mcp_schema_unsupported");
});
it("hashes payloads deterministically while retaining array order and exact values", () => {
  expect(mcpRequestHash({b:{d:2,c:1},a:0})).toBe(mcpRequestHash({a:0,b:{c:1,d:2}}));
  expect(mcpRequestHash({a:[1,2]})).not.toBe(mcpRequestHash({a:[2,1]}));
});
