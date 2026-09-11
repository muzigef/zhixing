import type { ModelCapabilities } from "./model-capabilities.js";
import type { ReasoningProfile } from "./model.js";
import type { TeamConfiguration, TeamMemberResourcePolicy } from "./team-contracts.js";

/** Local scheduling targets, not promises about provider accuracy or hard reasoning limits. */
export function memberResourcePolicy(config: TeamConfiguration, capabilities: ModelCapabilities, inherited: ReasoningProfile, member: TeamConfiguration["members"][number]): TeamMemberResourcePolicy | undefined {
  if (capabilities.reasoningBudget !== "shared-output") return undefined;
  const total = config.maxOutputTokens;
  const reserves = Math.min(1024, Math.floor(total / 16)) + Math.min(2048, Math.floor(total / 8)) + Math.min(4096, Math.floor(total / 2));
  const share = Math.floor((total - reserves) / config.members.length);
  const ceiling = Math.min(16384, member.maxOutputTokens ?? 16384, capabilities.maxOutputTokens, share);
  const requested = member.reasoning ?? inherited;
  const targets = { quick: 4096, balanced: 8192, deep: 16384 };
  const reasoning = !member.reasoning && ceiling < targets[requested]
    ? requested === "deep" && ceiling >= targets.balanced ? "balanced" : "quick"
    : requested;
  const recommendedMinTokens = targets[reasoning];
  return {
    version: 1, reasoning,
    reasoningSource: member.reasoning ? "explicit" : reasoning === inherited ? "inherited" : "budget-aware",
    maxOutputTokens: Math.min(ceiling, member.maxOutputTokens ?? recommendedMinTokens),
    recommendedMinTokens, budgetLimited: ceiling < recommendedMinTokens,
  };
}
