import { describe, expect, it } from "vitest";
import { authorizationMessage, decideInteraction, nextInteractionMode } from "../src/interaction-protocol.js";
import { authorizeConversationTransition, hasUserTextEvidence } from "../src/conversation-policy.js";

describe("global interaction protocol", () => {
  it("routes every turn through one typed control decision", () => {
    expect(decideInteraction("开始第 1 天", "learning")).toMatchObject({ kind: "command", command: "开始第 1 天" });
    expect(decideInteraction("直接运行 --确认", "pending_plan")).toEqual({ kind: "execute_pending", confirmed: true });
    expect(decideInteraction("请给第一题答案", "teaching")).toMatchObject({ kind: "teaching_input" });
    expect(decideInteraction("帮我做一个新的学习计划", "learning")).toMatchObject({ kind: "natural_input" });
  });
  it("accepts natural plan confirmation only when a reviewed draft exists", () => {
    expect(decideInteraction("就按这个来", "pending_plan")).toEqual({ kind: "execute_pending", confirmed: false });
    expect(decideInteraction("好，执行吧", "pending_plan")).toEqual({ kind: "execute_pending", confirmed: false });
    expect(decideInteraction("就按这个来", "teaching")).toMatchObject({ kind: "teaching_input" });
    expect(decideInteraction("这个方案会删除资料吗？", "pending_plan")).toMatchObject({ kind: "natural_input" });
  });
  it("derives state from persisted checkpoints and pending plans", () => {
    expect(nextInteractionMode(false, false)).toBe("learning");
    expect(nextInteractionMode(true, false)).toBe("teaching");
    expect(nextInteractionMode(true, true)).toBe("pending_plan");
  });
  it("keeps high-risk authorization in the control plane", () => {
    expect(authorizationMessage(decideInteraction("模型切换 tutor mock", "learning"))).toContain("--确认");
    expect(authorizationMessage(decideInteraction("模型切换 tutor mock --确认", "learning"))).toBeUndefined();
  });
  it("uses one evidence and confirmation policy for model-originated transitions", () => {
    expect(hasUserTextEvidence("我认为协方差描述形状", "协方差描述形状")).toBe(true);
    expect(authorizeConversationTransition({ source: "model_classification", mutatesState: true, userConfirmed: true, requiresUserEvidence: true, hasUserEvidence: false })).toEqual({ allowed: false, reason: "user_evidence_required" });
    expect(authorizeConversationTransition({ source: "model_proposal", mutatesState: true, userConfirmed: false, requiresExplicitConfirmation: true })).toEqual({ allowed: false, reason: "user_confirmation_required" });
  });
});
