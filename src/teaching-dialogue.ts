import { z } from "zod";
import { authorizeConversationTransition, hasUserTextEvidence } from "./conversation-policy.js";

/** The only learner intents accepted while a teaching checkpoint is active. */
export const teachingActionSchema = z.object({
  action: z.enum(["start_practice", "answer_question", "request_solution", "ask_question", "skip_question", "change_plan"]),
  target: z.string().min(1).max(80).default("current"),
  learnerAnswer: z.string().max(8_000).optional(),
});
export type TeachingAction = z.infer<typeof teachingActionSchema>;
export interface TeachingInterpretation {
  readonly action: TeachingAction;
  /** Only this evidence-bearing flag may trigger grading or attempt persistence. */
  readonly hasVerifiedSubmission: boolean;
  readonly source: "deterministic_request" | "verified_submission" | "model_classification" | "safe_fallback";
}

export function parseTeachingAction(text: string, originalInput = ""): TeachingAction {
  // Requests for a solution are a safety-critical learner intent. Do not let a
  // probabilistic classifier turn them into an imaginary submission.
  if (isSolutionRequest(originalInput)) return { action: "request_solution", target: "current" };
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  try { return teachingActionSchema.parse(JSON.parse(json ?? "")); }
  catch { return { action: "ask_question", target: "current" }; }
}

/** Explicit learner requests bypass the classifier; ordinary answers remain evidence-checked. */
export function resolveTeachingInput(input: string, hasExercise: boolean): TeachingInterpretation | undefined {
  const text = input.replace(/\s+/g, "");
  const direct = (action: TeachingAction["action"]): TeachingInterpretation => ({ action: { action, target: "current" }, hasVerifiedSubmission: false, source: "deterministic_request" });
  if (/(?:不要|别|先不|暂不|不想).{0,12}(?:答案|解答|解析|练习|出题)/.test(text)) return direct("ask_question");
  if (isSolutionRequest(text)) return direct("request_solution");
  if (/^(?:请)?(?:跳过(?:这道|当前|这)?(?:题|问题|练习)?|换(?:一|这)?道题|下一题)(?:吧|。|！|!)?$/.test(text)) return direct(hasExercise ? "skip_question" : "start_practice");
  if (/^(?:(?:没有问题|没问题|懂了|明白了|我准备好了)[，,。]?)?(?:请)?(?:开始练习|进入练习|出题|(?:来|出|给我)[一二三四五六七八九十两\d]+道(?:应用|概念|选择|计算|推导)?题)(?:吧|。|！|!)?$/.test(text)) return direct("start_practice");
  if (!hasExercise || /[？?]|(?:继续|重新回答|为什么|怎么|如何|什么|解释|讲解|提示|举例|例子|简短|详细|说法|没明白|不明白|不知道|不会|不懂|先别|先不)/.test(text)) return direct("ask_question");
  const explicitAnswer = /^(?:我的答案是|答案是|答[:：])\s*(.+)$/.exec(input.trim())?.[1];
  if (explicitAnswer || /^(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\/\d+)?|[A-Da-d]|[a-zA-Z]\s*=\s*[+-]?\d+(?:\.\d+)?)$/.test(input.trim())) {
    return { action: { action: "answer_question", target: "current", learnerAnswer: explicitAnswer ?? input.trim() }, hasVerifiedSubmission: true, source: "verified_submission" };
  }
  return undefined;
}

export function isSolutionRequest(input: string): boolean {
  const text = input.replace(/\s+/g, "");
  if (/(?:不要|别|先不|暂不|不想).{0,12}(?:答案|解答|解析)/.test(text)) return false;
  return /^(?:请|麻烦)?(?:直接|先|现在)?(?:给(?:出|我)?|告诉我|展示|提供)[^，。！？?]{0,32}(?:答案|解答|解析|解题思路)(?:吧|。|！|!)?$/.test(text)
    || /^(?:(?:第[一二三四五六七八九十\d]+题|这道题|当前题)(?:的)?)?(?:参考)?(?:答案|解答|解析)(?:是什么|呢|吧|[？?。！!])?$/.test(text);
}

/**
 * Converts model classification into a state-machine-safe learner intent.
 * Models can suggest an action, but cannot manufacture a submission or cause
 * grading without text verifiably supplied by the learner.
 */
export function interpretTeachingInput(classifierOutput: string, originalInput: string): TeachingInterpretation {
  const deterministic = resolveTeachingInput(originalInput, true);
  if (deterministic) return deterministic;
  const action = parseTeachingAction(classifierOutput);
  if (action.action === "answer_question") {
    if (authorizeConversationTransition({ source: "model_classification", mutatesState: true, userConfirmed: true, requiresUserEvidence: true, hasUserEvidence: recordsLearnerAttempt(action, originalInput) }).allowed) return { action, hasVerifiedSubmission: true, source: "verified_submission" };
    // An unverified "answer" label is a question/clarification, never grading.
    return { action: { action: "ask_question", target: action.target }, hasVerifiedSubmission: false, source: "safe_fallback" };
  }
  return { action: { action: "ask_question", target: action.target }, hasVerifiedSubmission: false, source: "safe_fallback" };
}

/** A request for a solution must never be recorded as a learner attempt. */
export function recordsLearnerAttempt(action: TeachingAction, originalInput: string): boolean {
  if (action.action !== "answer_question" || !action.learnerAnswer?.trim()) return false;
  // The classifier must quote a meaningful portion of what the learner actually
  // wrote; it cannot invent an answer and turn a request into a submission.
  return hasUserTextEvidence(originalInput, action.learnerAnswer);
}
