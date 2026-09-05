import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths.js";
import { TeachingSessionStore } from "../src/teaching-session-store.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("teaching session checkpoint", () => {
  it("bounds long model answers before checkpoint validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-long-")); roots.push(root);
    const store = new TeachingSessionStore(new PathPolicy(root));
    await expect(store.save("rag", { dayCard: "card", stage: "answer_questions", quizRound: 0, transcript: ["教师：" + "字".repeat(9_000)] })).resolves.toMatchObject({ topicId: "rag" });
    const restored = await store.load("rag");
    expect(restored?.transcript[0]?.length).toBeLessThanOrEqual(8_000);
    expect(restored?.transcript[0]).toContain("截断");
  });
  it("rejects a checkpoint labelled with another topic", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-topic-")); roots.push(root);
    const policy = new PathPolicy(root); const store = new TeachingSessionStore(policy);
    const value = await store.save("rag", { dayCard: "card", stage: "practice", quizRound: 0 });
    await fs.writeFile(policy.resolveTopicPath("rag", "sessions", "teaching.json"), JSON.stringify({ ...value, topicId: "other" }));
    await expect(store.load("rag")).rejects.toThrow("cross_topic_denied");
  });
  it("restores the answer-and-practice stage after a process restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-")); roots.push(root);
    const first = new TeachingSessionStore(new PathPolicy(root));
    await first.save("rag", { dayId: "D01", dayCard: "RAG 基础", stage: "practice", quizRound: 2, transcript: ["教师：问题 1"], currentExercise: "问题 1", learnerAttempts: ["用户：回答"] });
    const restored = await new TeachingSessionStore(new PathPolicy(root)).load("rag");
    expect(restored).toMatchObject({ topicId: "rag", dayId: "D01", stage: "practice", quizRound: 2 });
    expect(restored?.currentExercise).toBe("问题 1");
    expect(restored?.transcript).toEqual(["教师：问题 1"]);
  });
});
