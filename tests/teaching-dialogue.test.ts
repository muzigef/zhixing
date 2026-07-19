import { describe, expect, it } from "vitest";
import { interpretTeachingInput, parseTeachingAction, recordsLearnerAttempt } from "../src/teaching-dialogue.js";

describe("teaching dialogue action contract", () => {
  it("never records a requested solution as an answer", () => {
    const action = parseTeachingAction('{"action":"request_solution","target":"question_1"}');
    expect(action.action).toBe("request_solution");
    expect(recordsLearnerAttempt(action, "直接给出第一题的答案")).toBe(false);
  });
  it("gives deterministic priority to natural requests for a solution", () => {
    expect(parseTeachingAction('{"action":"answer_question","target":"current","learnerAnswer":"虚构答案"}', "给出答案")).toMatchObject({ action: "request_solution" });
    expect(parseTeachingAction('{"action":"answer_question","target":"current"}', "请直接给出这道补充题的参考答案")).toMatchObject({ action: "request_solution" });
  });
  it("requires answer text before recording an answer", () => {
    expect(recordsLearnerAttempt(parseTeachingAction('{"action":"answer_question","target":"current"}'), "协方差控制形状")).toBe(false);
    expect(recordsLearnerAttempt(parseTeachingAction('{"action":"answer_question","target":"current","learnerAnswer":"协方差控制形状"}'), "我认为协方差控制形状和方向")).toBe(true);
  });
  it("rejects a classifier-invented answer", () => {
    const action = parseTeachingAction('{"action":"answer_question","target":"current","learnerAnswer":"高斯参数包括位置协方差不透明度和球谐"}');
    expect(recordsLearnerAttempt(action, "直接给第一题答案")).toBe(false);
  });
  it("requires evidence from the learner before a classifier can trigger grading", () => {
    const invented = interpretTeachingInput('{"action":"answer_question","target":"current","learnerAnswer":"一个模型编造的答案"}', "给出答案");
    expect(invented).toMatchObject({ action: { action: "request_solution" }, hasVerifiedSubmission: false, source: "deterministic_request" });
    const unsupported = interpretTeachingInput('{"action":"answer_question","target":"current","learnerAnswer":"模型虚构答案"}', "我不太明白题目");
    expect(unsupported).toMatchObject({ action: { action: "ask_question" }, hasVerifiedSubmission: false, source: "safe_fallback" });
    const submitted = interpretTeachingInput('{"action":"answer_question","target":"current","learnerAnswer":"协方差矩阵表示高斯的形状和方向"}', "我认为协方差矩阵表示高斯的形状和方向");
    expect(submitted).toMatchObject({ action: { action: "answer_question" }, hasVerifiedSubmission: true, source: "verified_submission" });
  });
});
