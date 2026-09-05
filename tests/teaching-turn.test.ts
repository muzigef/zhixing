import { describe, expect, it } from "vitest";
import { completeTeachingTurn } from "../src/teaching-turn.js";
import { interpretTeachingInput } from "../src/teaching-dialogue.js";
import type { TeachingSession } from "../src/teaching-session-store.js";

const session: TeachingSession = { topicId: "rag", dayCard: "card", stage: "practice", quizRound: 20, transcript: [], learnerAttempts: [], currentExercise: "original question", updatedAt: "2026-09-05T00:00:00.000Z" };
describe("teaching turn commits", () => {
  it("retains the exercise when giving a solution or grading an answer", () => {
    const interpreted = interpretTeachingInput("{}", "给出答案");
    const next = completeTeachingTurn(session, "给出答案", interpreted, { text: "reference solution" });
    expect(next.currentExercise).toBe("original question");
    expect(next.quizRound).toBe(20);
    expect(next.learnerAttempts).toEqual([]);
  });
  it("does not advance stage or replace the exercise on partial output", () => {
    const interpreted = interpretTeachingInput('{"action":"start_practice"}', "没有问题，开始练习");
    const previous = { ...session, stage: "answer_questions" as const };
    const next = completeTeachingTurn(previous, "没有问题，开始练习", interpreted, { text: "unfinished question", partial: true });
    expect(next.stage).toBe("answer_questions");
    expect(next.currentExercise).toBe("original question");
    expect(next.transcript?.at(-1)).toContain("未完成");
  });
});
