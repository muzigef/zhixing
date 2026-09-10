import { createHash } from "node:crypto";
import { executionEvidenceSchema, type ExecutionEvidence } from "./team-work-contracts.js";
export type { ExecutionEvidence } from "./team-work-contracts.js";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
/** Runtime-owned receipt; its existence proves an observed execution, not the truth of a model claim. */
export function executionEvidence(executionId: string, callId: string, tool: string, input: unknown, result: { ok: boolean }): ExecutionEvidence {
  const data = { executionId, callId, tool, inputHash: hash(input), outputHash: hash(result), ok: result.ok };
  return executionEvidenceSchema.parse({ id: hash(data), ...data });
}
