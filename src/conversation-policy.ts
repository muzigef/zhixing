/**
 * Common authority boundary for every conversational state transition.
 * Model text is a proposal; user-originated evidence and confirmation are the
 * only ways to turn it into a persisted action or a claimed learner fact.
 */
export type ConversationSource = "user_command" | "model_proposal" | "model_classification";
export type ConversationPolicyResult = { allowed: true } | { allowed: false; reason: "user_confirmation_required" | "user_evidence_required" };

export function hasUserTextEvidence(originalInput: string, claimedText: string | undefined): boolean {
  if (!claimedText?.trim()) return false;
  const normalize = (value: string) => value.replace(/[\s，。；：、,.!?！？]/g, "");
  const claim = normalize(claimedText);
  const input = normalize(originalInput);
  return claim.length >= 4 && input.includes(claim);
}

export function authorizeConversationTransition(input: {
  source: ConversationSource;
  mutatesState: boolean;
  userConfirmed: boolean;
  explicitlyConfirmed?: boolean;
  requiresExplicitConfirmation?: boolean;
  requiresUserEvidence?: boolean;
  hasUserEvidence?: boolean;
}): ConversationPolicyResult {
  if (input.requiresUserEvidence && !input.hasUserEvidence) return { allowed: false, reason: "user_evidence_required" };
  if (input.requiresExplicitConfirmation && !(input.explicitlyConfirmed ?? input.userConfirmed)) return { allowed: false, reason: "user_confirmation_required" };
  if (input.mutatesState && input.source !== "user_command" && !input.userConfirmed) return { allowed: false, reason: "user_confirmation_required" };
  return { allowed: true };
}
