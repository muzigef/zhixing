/** Stable result metadata survives truncation. The preview is never a complete result. */
export function boundToolOutput(output: unknown, maximum = 11_000, reference?: { resultId: string }): unknown {
  const serialized = JSON.stringify(output ?? null);
  if (serialized === undefined) throw new Error("tool_output_invalid");
  if (serialized.length <= maximum) return output ?? null;
  const metadata: Record<string, unknown> = {};
  if (output && typeof output === "object" && !Array.isArray(output)) {
    for (const key of ["ok", "status", "errorCode", "exitCode", "id", "projectId", "hash", "treeHash", "commit", "resultId", "nextOffset"] as const) {
      const value = (output as Record<string, unknown>)[key];
      if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string" && value.length <= 200) metadata[key] = value;
    }
  }
  const bounded = { ...metadata, truncated: true, totalChars: serialized.length, ...reference, preview: serialized.slice(0, Math.min(6000, maximum - 1200)) };
  // JSON escaping can expand even a short preview; bound the actual serialized envelope.
  while (JSON.stringify(bounded).length > maximum - 100) bounded.preview = bounded.preview.slice(0, Math.floor(bounded.preview.length * 0.8));
  return bounded;
}
