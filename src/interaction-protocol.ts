import { z } from "zod";
import { isAutomatableConversationCommand, requiresConversationConfirmation } from "./intent-parser.js";
import { ActionRegistry, type RegisteredAction } from "./action-registry.js";
import { authorizeConversationTransition } from "./conversation-policy.js";

/**
 * Single control-plane contract for every user turn. Content generators may
 * suggest an action, but only this layer decides whether it is compatible with
 * the current state and whether explicit confirmation is required.
 */
export const interactionModeSchema = z.enum(["learning", "teaching", "pending_plan"]);
export type InteractionMode = z.infer<typeof interactionModeSchema>;

export const interactionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), command: z.string().min(1).max(8_000), confirmationRequired: z.boolean(), confirmed: z.boolean(), actionId: z.string().min(1).optional() }),
  z.object({ kind: z.literal("execute_pending"), confirmed: z.boolean() }),
  z.object({ kind: z.literal("teaching_input"), text: z.string().min(1).max(8_000) }),
  z.object({ kind: z.literal("natural_input"), text: z.string().min(1).max(8_000) }),
]);
export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;

export function decideInteraction(input: string, mode: InteractionMode, registry = new ActionRegistry()): InteractionDecision {
  const command = input.trim();
  const confirmed = /^(你)?直接运行\s+--确认$|^我?确认执行$/.test(command);
  if (/^(你)?直接运行(吧)?$|^确认执行$/.test(command) || confirmed) return { kind: "execute_pending", confirmed };
  if (mode === "pending_plan" && /^(?:就按这个(?:来|执行)|按这个方案(?:执行)?|好[，, ]*执行吧|可以[，, ]*开始(?:吧)?)[。！!]?$/u.test(command)) return { kind: "execute_pending", confirmed: false };
  const action: RegisteredAction | undefined = registry.resolve(command);
  if (action) return { kind: "command", command, confirmationRequired: action.confirmationRequired, confirmed: action.confirmed, actionId: action.id };
  if (mode === "teaching") return { kind: "teaching_input", text: command };
  if (isAutomatableConversationCommand(command)) return { kind: "command", command, confirmationRequired: requiresConversationConfirmation(command), confirmed: /\s+--确认$/.test(command) };
  return { kind: "natural_input", text: command };
}

export function nextInteractionMode(hasTeachingCheckpoint: boolean, hasPendingPlan: boolean): InteractionMode {
  if (hasPendingPlan) return "pending_plan";
  return hasTeachingCheckpoint ? "teaching" : "learning";
}

/** Policy result is derived from the typed decision, never from a CLI handler. */
export function authorizationMessage(decision: InteractionDecision): string | undefined {
  if (decision.kind !== "command") return undefined;
  const policy = authorizeConversationTransition({ source: "user_command", mutatesState: decision.confirmationRequired, userConfirmed: decision.confirmed, requiresExplicitConfirmation: decision.confirmationRequired });
  if (policy.allowed) return undefined;
  return `该操作需要明确确认。请核对后使用“${decision.command} --确认”。`;
}
