import { expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { AssessmentStore } from "../src/learning-assessment.js";

it("uses independent answers, stores error causes and schedules review separately from evidence completeness", () => {
  const database = new ZhixingDatabase(":memory:");
  try {
    const store = new AssessmentStore(database); const attempt = store.issue("agent-development", "D01");
    expect(JSON.stringify(attempt)).not.toContain("correct");
    expect(attempt.questions.length).toBeGreaterThan(1);
    const result = store.submit("agent-development", "D01", attempt.id, [1, 1], "我把模型输出与实际执行混淆了。", new Date("2026-09-06T00:00:00Z"));
    expect(result.status).toBe("practice_needed"); expect(result.errorCauses.length).toBeGreaterThan(0);
    expect(result.reviewAt).toBe("2026-09-07T00:00:00.000Z");
    expect(store.summary("agent-development")[0]?.status).toBe("practice_needed");
    expect(store.summary("rag")).toEqual([]);
    expect(() => store.submit("rag", "D01", attempt.id, [0, 0], "")).toThrow("cross_topic_denied");
    expect(() => store.submit("agent-development", "D01", attempt.id, [0, 0], "")).toThrow("assessment_already_submitted");
  } finally { database.close(); }
});
it("distinguishes passing this check from broad mastery and refuses missing custom-course checks", () => {
  const database = new ZhixingDatabase(":memory:");
  try {
    const store = new AssessmentStore(database); const attempt = store.issue("agent-development", "D01");
    const result = store.submit("agent-development", "D01", attempt.id, [0, 2], "边界必须由 Runtime 执行。", new Date("2026-09-06T00:00:00Z"));
    expect(result.status).toBe("checks_passed"); expect(result.correctCount).toBe(2);
    expect(result.reviewAt).toBe("2026-09-09T00:00:00.000Z");
    expect(() => store.issue("custom-topic", "D01")).toThrow("assessment_not_available");
    expect(() => store.submit("agent-development", "D01", "forged", [0, 2], "")).toThrow();
  } finally { database.close(); }
});
