import { describe, expect, it } from "vitest";
import { conversationPlanSchema, isAutomatableConversationCommand, isDirectAnswerRequest, parseLocalIntent, requiresConversationConfirmation } from "../src/intent-parser.js";
describe("local intent parser", () => {
  it("maps safe aliases without a model", () => { expect(parseLocalIntent("今天学什么？").intent).toEqual({ intent: "next_step" }); expect(parseLocalIntent("看进度").intent).toEqual({ intent: "progress" }); });
  it("answers the current-topic question locally", () => { expect(parseLocalIntent("当前在学习的是哪个主题").intent).toEqual({ intent: "current_topic" }); });
  it("recognizes a request for an answer without treating it as a learner attempt", () => {
    expect(isDirectAnswerRequest("直接给出第一题的答案")).toBe(true);
    expect(isDirectAnswerRequest("请给我参考答案")).toBe(true);
    expect(isDirectAnswerRequest("我认为协方差矩阵决定形状")).toBe(false);
  });
  it("returns write candidates instead of executing ambiguous requests", () => { expect(parseLocalIntent("帮我创建一个学习主题").candidates).toContain("创建主题 <topicId> <标题>"); });
  it("only accepts whitelisted learning-plan actions", () => {
    expect(conversationPlanSchema.parse({ kind: "proposal", topicId: "3dgs", summary: "3DGS 计划", actions: [{ type: "set_learning_profile", goal: "完成 3DGS 项目", level: "初学", dailyMinutes: 120, totalDays: 84 }, { type: "generate_custom_course" }] }).kind).toBe("proposal");
    expect(() => conversationPlanSchema.parse({ kind: "proposal", topicId: "3dgs", summary: "x", actions: [{ type: "shell", command: "rm -rf /" }] })).toThrow();
  });
  it("allows canonical Zhixing commands but never shell", () => {
    expect(isAutomatableConversationCommand("提醒设置 09:30")).toBe(true);
    expect(isAutomatableConversationCommand("设置学习画像 3dgs 目标 掌握3DGS原理与实现 水平 初学者 每日 120分钟 总计 84天")).toBe(true);
    expect(isAutomatableConversationCommand("导入资料 rag/provider-smoke.md")).toBe(true);
    expect(isAutomatableConversationCommand("备份数据库")).toBe(true);
    expect(isAutomatableConversationCommand("资料删除预览 rag doc-123")).toBe(true);
    expect(isAutomatableConversationCommand("npm run cli -- plan create")).toBe(false);
  });
  it("marks state-replacing commands for explicit human confirmation", () => {
    expect(requiresConversationConfirmation("启用定制课程 course-2026-07-18T08-57-06-287Z --确认")).toBe(true);
    expect(requiresConversationConfirmation("启用课程 course-2026-07-18T08-57-06-287Z --确认")).toBe(true);
    expect(requiresConversationConfirmation("提醒设置 09:30")).toBe(false);
  });
  it("accepts the real-model Chinese profile alias and both course-activation aliases", () => {
    expect(isAutomatableConversationCommand("设置学习画像 3dgs 目标 掌握3DGS原理与实现并完成项目实践 水平 初学者 每日 120分钟 总计 84天")).toBe(true);
    expect(isAutomatableConversationCommand("启用课程 course-2026-07-18T12-15-49-879Z --确认")).toBe(true);
    expect(isAutomatableConversationCommand("启用定制课程 course-2026-07-18T12-15-49-879Z --确认")).toBe(true);
  });
});
