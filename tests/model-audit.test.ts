import { describe, expect, it } from "vitest";
import { createModelAudit } from "../src/model-audit.js";

describe("model audit", () => {
  it("只生成元数据字段", () => {
    const record = createModelAudit("deepseek-api", "tutor", Date.now() - 5, "success");
    expect(record.providerId).toBe("deepseek-api");
    expect(record.role).toBe("tutor");
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record)).not.toContain("prompt");
  });
});
