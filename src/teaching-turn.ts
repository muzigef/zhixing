import type { TeachingInterpretation } from "./teaching-dialogue.js";
import type { TeachingSession, TeachingSessionInput } from "./teaching-session-store.js";

/** Commit only completed teaching transitions; solutions never replace the active question. */
export function completeTeachingTurn(session: TeachingSession, userInput: string, interpreted: TeachingInterpretation, result: { text: string; partial?: boolean }): TeachingSessionInput {
  const newExercise = !result.partial && ["start_practice", "skip_question"].includes(interpreted.action.action);
  if (newExercise && session.quizRound >= 20) throw new Error("practice_round_limit");
  return {
    ...session,
    stage: newExercise ? "practice" : session.stage,
    quizRound: newExercise ? session.quizRound + 1 : session.quizRound,
    currentExercise: newExercise ? result.text.slice(0, 8_000) : session.currentExercise,
    transcript: [...session.transcript, `用户：${userInput}`, `教师${result.partial ? "（未完成）" : ""}：${result.text}`].slice(-12),
    learnerAttempts: !result.partial && interpreted.hasVerifiedSubmission && interpreted.action.learnerAnswer
      ? [...session.learnerAttempts, interpreted.action.learnerAnswer].slice(-8) : session.learnerAttempts,
  };
}
