export interface ModelAuditRecord {
  readonly providerId: string;
  readonly role: "tutor" | "reviewer" | "lab";
  readonly durationMs: number;
  readonly status: "success" | "error" | "cancelled";
  readonly events: number;
  readonly turns: number;
  readonly toolCalls: number;
}

/** Produces metadata-only model audit records; prompts and responses are intentionally excluded. */
export function createModelAudit(providerId: ModelAuditRecord["providerId"], role: ModelAuditRecord["role"], startedAt: number, status: ModelAuditRecord["status"], trace: Pick<ModelAuditRecord, "events" | "turns" | "toolCalls"> = { events: 0, turns: 0, toolCalls: 0 }): ModelAuditRecord {
  return { providerId, role, durationMs: Math.max(0, Date.now() - startedAt), status, ...trace };
}
