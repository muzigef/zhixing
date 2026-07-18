export interface ModelAuditRecord {
  readonly providerId: string;
  readonly role: "tutor" | "reviewer" | "lab";
  readonly durationMs: number;
  readonly status: "success" | "error" | "cancelled";
}

/** Produces metadata-only model audit records; prompts and responses are intentionally excluded. */
export function createModelAudit(providerId: ModelAuditRecord["providerId"], role: ModelAuditRecord["role"], startedAt: number, status: ModelAuditRecord["status"]): ModelAuditRecord {
  return { providerId, role, durationMs: Math.max(0, Date.now() - startedAt), status };
}
