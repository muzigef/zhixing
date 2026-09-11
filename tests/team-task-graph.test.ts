import { describe, expect, it } from "vitest";
import { createTaskGraph, parseTaskPlan, runTaskGraph, validatePlanScope } from "../src/team-task-graph.js";
import { buildTeamPacket, packetMessages } from "../src/team-task-packet.js";

const plan = { tasks: [
  { id: "derive", member: 1, goal: "推导", dependsOn: [], acceptance: ["列出前提"] },
  { id: "check", member: 2, goal: "核对推导", dependsOn: ["derive"], acceptance: ["验证边界"] },
] };
describe("team task contracts and scheduling", () => {
  it("rejects internal protocol checks while allowing actual user requests about protocols and final JSON fields", () => {
    const tasks = parseTaskPlan(plan, 2);
    tasks[0]!.acceptance = ["确认本轮只输出任务安排JSON"];
    expect(() => validatePlanScope(tasks, "计算17乘19，返回value和explanation")).toThrow("team_plan_invalid");
    expect(() => validatePlanScope(tasks, "请设计任务安排JSON的结构和校验规则")).not.toThrow();
    tasks[0]!.acceptance = ["最终JSON包含value和explanation，数值可核对"];
    expect(() => validatePlanScope(tasks, "计算17乘19，返回value和explanation")).not.toThrow();
    tasks[0]!.acceptance = ["核对TEAM_MEMBER格式与TEAM_REVIEW保持一致"];
    expect(() => validatePlanScope(tasks, "计算17乘19")).toThrow("team_plan_invalid");
    tasks[0]!.acceptance = ["核对主 Agent 最终输出是否包含value"];
    expect(() => validatePlanScope(tasks, "计算17乘19，返回value")).toThrow("team_plan_invalid");
    expect(() => validatePlanScope(tasks, "核对这份主 Agent 最终输出：{value:323}")).not.toThrow();
  });
  it("rejects cycles, unknown dependencies, omitted members and authority fields", () => {
    expect(() => parseTaskPlan({ tasks: [{ ...plan.tasks[0], dependsOn: ["check"] }, plan.tasks[1]] }, 2)).toThrow();
    expect(() => parseTaskPlan({ tasks: [{ ...plan.tasks[0], dependsOn: ["missing"] }, plan.tasks[1]] }, 2)).toThrow();
    expect(() => parseTaskPlan({ tasks: [plan.tasks[0]] }, 2)).toThrow();
    expect(() => parseTaskPlan({ tasks: [{ ...plan.tasks[0], tools: ["write_file"] }, plan.tasks[1]] }, 2)).toThrow();
    expect(() => parseTaskPlan({ tasks: [plan.tasks[0], { ...plan.tasks[1], id: "derive" }] }, 2)).toThrow();
  });
  it("saves the running transition before dispatch and only exposes completed dependencies", async () => {
    const tasks = createTaskGraph(parseTaskPlan(plan, 2)); const events: string[] = [];
    await runTaskGraph(tasks, 2, async task => {
      events.push(task.key); expect(events.at(-2)).toBe(`saved:${task.key}`);
      if (task.key === "check") expect(tasks[0]?.status).toBe("completed");
      task.status = "completed";
    }, async () => { for (const task of tasks.filter(item => item.status === "running")) events.push(`saved:${task.key}`); }, new AbortController().signal);
    expect(events.filter(event => !event.startsWith("saved:"))).toEqual(["derive", "check"]);
  });
  it("blocks failed dependencies while allowing unrelated tasks and serializes each member", async () => {
    const tasks = createTaskGraph(parseTaskPlan({ tasks: [...plan.tasks, { id: "independent", member: 1, goal: "反例", dependsOn: [], acceptance: ["给出例子"] }] }, 2));
    const called: string[] = [];
    await runTaskGraph(tasks, 2, async task => { called.push(task.key); task.status = task.key === "derive" ? "failed" : "completed"; }, async () => {}, new AbortController().signal);
    expect(called).toEqual(["derive", "independent"]); expect(tasks[1]?.status).toBe("blocked");
  });
  it("fails closed on persistence errors and cancellation", async () => {
    const tasks = createTaskGraph(parseTaskPlan(plan, 2)); let calls = 0;
    await expect(runTaskGraph(tasks, 2, async () => { calls++; }, async () => { throw new Error("storage"); }, new AbortController().signal)).rejects.toThrow("storage");
    expect(calls).toBe(0);
    const controller = new AbortController(); controller.abort();
    await expect(runTaskGraph(createTaskGraph(parseTaskPlan(plan, 2)), 2, async () => { calls++; }, async () => {}, controller.signal)).rejects.toThrow(); expect(calls).toBe(0);
  });
});
describe("shared minimal task packet", () => {
  const messages = [{ role: "system" as const, content: "PRIVATE_SYSTEM" }, { role: "user" as const, content: "题设变量 x=2" }, { role: "assistant" as const, content: "历史回答" }, { role: "user" as const, content: "继续推导" }];
  it("requires context consent, strips instruction authority and shares one bounded packet", () => {
    const isolated = buildTeamPacket("继续推导", messages, false);
    expect(JSON.stringify(isolated)).not.toContain("x=2");
    const shared = buildTeamPacket("继续推导", messages, true);
    expect(JSON.stringify(shared)).toContain("x=2"); expect(JSON.stringify(shared)).not.toContain("PRIVATE_SYSTEM");
    expect(packetMessages(shared).filter(item => item.role === "observation")).toHaveLength(2);
    expect(buildTeamPacket("继续推导", messages, true).hash).toBe(shared.hash);
    const huge = buildTeamPacket("现在", [...Array.from({ length: 30 }, () => ({ role: "user" as const, content: "x".repeat(10_000) })), { role: "user", content: "现在" }], true);
    expect(JSON.stringify(huge).length).toBeLessThan(30_000); expect(huge.truncated).toBe(true);
  });
});
