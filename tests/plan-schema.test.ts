import { describe, expect, it } from "vitest";
import { topicPlanSchema } from "../src/plan-schema.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TopicPlanLoader } from "../src/plan-loader.js";
import { createDefaultTopicRegistry } from "../src/topics.js";

const plan = {
  topicId: "rag",
  title: "RAG",
  version: 1,
  prerequisites: [],
  days: [{ id: "D01", title: "检索", estimatedMinutes: 120, requiredEvidence: ["implementation", "failure-case"], optional: false }],
};

describe("topic plan schema", () => {
  it("接受有效主题计划", () => {
    expect(topicPlanSchema.parse(plan).topicId).toBe("rag");
  });

  it("拒绝重复 Day 和缺少证据", () => {
    expect(() => topicPlanSchema.parse({ ...plan, days: [plan.days[0], plan.days[0]] })).toThrow("唯一");
    expect(() => topicPlanSchema.parse({ ...plan, days: [{ ...plan.days[0], requiredEvidence: [] }] })).toThrow();
  });

  it("解析 Topic Plan 的逐 Day 时长、证据与可选项", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-plan-"));
    try {
      const file = path.join(root, "zhixing", "topics", "rag", "PLAN.md");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "---\ntopicId: rag\ntitle: RAG\nversion: 1\nprerequisites: []\ndays:\n  - id: D01\n    title: 检索\n    estimatedMinutes: 90\n    requiredEvidence: [implementation, failure-case]\n    optional: true\n---\n", "utf8");
      const topic = createDefaultTopicRegistry().get("rag");
      await expect(new TopicPlanLoader(root).day(topic, "D01")).resolves.toMatchObject({ title: "检索", estimatedMinutes: 90, optional: true, requiredEvidence: ["implementation", "failureCase"] });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
