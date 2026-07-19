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

export function isSolutionRequest(input: string): boolean {
  const normalized = input.replace(/\s+/g, "").toLowerCase();
  return /(?:给出|给我|直接给|告诉我|展示|提供)(?:参考)?(?:答案|解答|解析)|(?:参考)?(?:答案|解答|解析)(?:是什么|呢|吧)?$|^答案$/.test(normalized);
}

/**
 * Converts model classification into a state-machine-safe learner intent.
 * Models can suggest an action, but cannot manufacture a submission or cause
 * grading without text verifiably supplied by the learner.
 */
export function interpretTeachingInput(classifierOutput: string, originalInput: string): TeachingInterpretation {
  if (isSolutionRequest(originalInput)) return { action: { action: "request_solution", target: "current" }, hasVerifiedSubmission: false, source: "deterministic_request" };
  const action = parseTeachingAction(classifierOutput);
  if (action.action === "answer_question") {
    if (authorizeConversationTransition({ source: "model_classification", mutatesState: true, userConfirmed: true, requiresUserEvidence: true, hasUserEvidence: recordsLearnerAttempt(action, originalInput) }).allowed) return { action, hasVerifiedSubmission: true, source: "verified_submission" };
    // An unverified "answer" label is a question/clarification, never grading.
    return { action: { action: "ask_question", target: action.target }, hasVerifiedSubmission: false, source: "safe_fallback" };
  }
  return { action, hasVerifiedSubmission: false, source: "model_classification" };
}

/** A request for a solution must never be recorded as a learner attempt. */
export function recordsLearnerAttempt(action: TeachingAction, originalInput: string): boolean {
  if (action.action !== "answer_question" || !action.learnerAnswer?.trim()) return false;
  // The classifier must quote a meaningful portion of what the learner actually
  // wrote; it cannot invent an answer and turn a request into a submission.
  return hasUserTextEvidence(originalInput, action.learnerAnswer);
}
