import { expect, it } from "vitest";
import { JsonSchemaWorker } from "../src/json-schema-worker.js";
it("validates real SDK draft-07 schemas without removing their dialect or relaxing constraints", async () => {
  const worker = new JsonSchemaWorker(), signal = AbortSignal.timeout(5000);
  try {
    await worker.check("read", { schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }, signal);
    await expect(worker.check("read", { input: { path: "synthetic.txt" } }, signal)).resolves.toBeUndefined();
    await expect(worker.check("read", { input: { path: 2 } }, signal)).rejects.toThrow("mcp_input_invalid");
    await expect(worker.check("read", { input: { path: "x", extra: true } }, signal)).rejects.toThrow("mcp_input_invalid");
    await expect(worker.check("unknown", { schema: { $schema: "https://untrusted.invalid/schema", type: "object" } }, signal)).rejects.toThrow("mcp_schema_unsupported");
  } finally { await worker.close(); }
});
