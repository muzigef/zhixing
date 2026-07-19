import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths.js";
import { TeachingSessionStore } from "../src/teaching-session-store.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("teaching session checkpoint", () => {
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
