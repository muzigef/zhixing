import { describe, expect, it, vi } from "vitest";
import { TeamCoordinator } from "../src/team-coordinator.js";
import { teamConfigurationSchema, type TeamSnapshot } from "../src/team-contracts.js";
import type { ModelClient, ModelMessage } from "../src/model.js";
import { randomUUID } from "node:crypto";
import { fixtureTeamReport, fixtureTeamReview } from "./team-fixtures.js";

function fixture(fail = false) {
  const seen: { purpose: string; messages: readonly ModelMessage[] }[] = []; const saved: TeamSnapshot[] = [];
  const resolve = (provider: "mock" | "demo"): ModelClient => ({ identity: { provider, model: provider, connection: "local" }, async *stream(_prompt, _signal, options) {
    const messages = options?.messages ?? []; const purpose = messages.some(m => m.content.includes("TEAM_PLAN")) ? "plan" : messages.some(m => m.content.includes("TEAM_MEMBER")) ? "member" : messages.some(m => m.content.includes("TEAM_REVIEW")) ? "review" : "lead";
    seen.push({ purpose, messages });
    if (fail && provider === "demo") throw new Error("test_failure");
    yield { type: "text_delta", text: purpose === "plan" ? '{"tasks":["核查条件与计算","独立查找反例"]}' : purpose === "member" ? fixtureTeamReport : purpose === "review" ? fixtureTeamReview : "答案是 4。" }; yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } }; yield { type: "done" };
  } });
  const options = { runId: randomUUID(), providerId: "mock", client: resolve("mock"), prompt: "历史 SECRET\n2+2?", question: "2+2?", messages: [{ role: "system", content: "教学规则" }, { role: "user", content: "SECRET" }, { role: "user", content: "2+2?" }] as ModelMessage[], contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {} };
  return { seen, saved, resolve, options, save: async (state: TeamSnapshot) => { saved.push(structuredClone(state)); } };
}
describe("bounded team execution", () => {
  it("executes structured dependencies through the shared runtime with one consistent authorized packet", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const client: ModelClient = { ...f.resolve("mock"), async *stream(prompt, requestSignal, options) {
      if (options?.messages?.some(item => item.content.includes("TEAM_PLAN"))) {
        expect(JSON.stringify(options.messages)).toContain("SECRET"); expect(JSON.stringify(options.messages)).not.toContain("教学规则");
        yield { type: "text_delta", text: JSON.stringify({ tasks: [{ id: "first", member: 1, goal: "独立推导", dependsOn: [], acceptance: ["检查算术"] }, { id: "second", member: 2, goal: "复核第一个结果", dependsOn: ["first"], acceptance: ["验证边界"] }] }) };
        yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } }; yield { type: "done" }; return;
      }
      yield* f.resolve("mock").stream(prompt, requestSignal, options);
    } };
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team", shareContext: true }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    await team.run(f.options, signal);
    const members = f.seen.filter(item => item.purpose === "member");
    expect(JSON.stringify(members[0]?.messages)).not.toContain("MEMBER_RESULT"); expect(JSON.stringify(members[1]?.messages)).toContain("MEMBER_RESULT");
    expect(JSON.stringify(f.seen.find(item => item.purpose === "review")?.messages)).toContain("SECRET");
    expect(team.snapshot.tasks?.map(task => task.status)).toEqual(["completed", "completed"]);
  });
  it("bounds an unresponsive optional connection and keeps healthy work available", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const signal = new AbortController().signal;
      const resolve = (provider: string): ModelClient => ({ ...f.resolve(provider as "mock" | "demo"), prepare: async () => { if (provider === "demo") await new Promise(() => {}); } });
      const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "demo", required: false }, { role: "material-checker", provider: "mock" }] }), provider: "mock", resolve, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
      const work = team.run(f.options, signal); await vi.advanceTimersByTimeAsync(30_000);
      expect((await work).blocked).toBeUndefined();
      expect(team.snapshot.members[0]).toMatchObject({ status: "failed", failureCode: "timeout", attempts: 0 });
      expect(team.snapshot.members[1]?.status).toBe("completed");
    } finally { vi.useRealTimers(); }
  }, 1000);
  it("stops all dispatch when connection readiness cannot be saved", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock", resolve: () => f.resolve("mock"), reasoning: "balanced", scope: "scope", question: f.options.question, save: async state => { if (state.connections?.some(connection => connection.status === "ready")) throw new Error("synthetic_storage_failure"); await f.save(state); } }, signal);
    await expect(team.run(f.options, signal)).rejects.toThrow("synthetic_storage_failure");
    expect(f.seen).toHaveLength(0);
  });
  it.each([false, true])("isolates member preparation failure and preserves required=%s in final completion", async required => {
    const f = fixture(); const signal = new AbortController().signal;
    const resolve = (provider: string): ModelClient => ({ ...f.resolve(provider as "mock" | "demo"), prepare: async () => { if (provider === "demo") throw new Error("secret_store_unavailable"); } });
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "demo", required }, { role: "material-checker", provider: "mock" }] }), provider: "mock", resolve, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    const result = await team.run(f.options, signal);
    expect(Boolean(result.blocked)).toBe(required);
    expect(team.snapshot.status).toBe("partial");
    expect(team.snapshot.members.map(member => member.status)).toEqual(["failed", "completed"]);
    expect(team.snapshot.members[0]).toMatchObject({ attempts: 0, failureCode: "authentication" });
    expect(f.seen.map(call => call.purpose)).toEqual(["plan", "member", "review", "lead"]);
    expect(JSON.stringify(team.snapshot)).not.toContain("secret_store_unavailable");
  });
  it("cancels an uncooperative preparation without starting any model requests", async () => {
    const f = fixture(); const controller = new AbortController(); let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const client: ModelClient = { ...f.resolve("mock"), prepare: () => { started(); return new Promise(() => {}); } };
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, controller.signal);
    const work = team.run(f.options, controller.signal); const cancelled = expect(work).rejects.toThrow();
    await ready; controller.abort(); await cancelled;
    expect(f.seen).toHaveLength(0); expect(team.snapshot.status).toBe("interrupted");
  }, 1000);
  it("does not dispatch members when the lead cannot prepare", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const client: ModelClient = { ...f.resolve("mock"), prepare: async () => { throw new Error("synthetic_private_detail"); } };
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    await expect(team.run(f.options, signal)).rejects.toThrow("provider_unavailable");
    expect(f.seen).toHaveLength(0); expect(team.snapshot.status).toBe("failed");
    expect(JSON.stringify(team.snapshot)).not.toContain("synthetic_private_detail");
  });
  it("keeps optional failures visible without blocking a completed main answer", async () => {
    const f = fixture(true); const signal = new AbortController().signal;
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "demo", required: false }] }), provider: "mock", resolve: provider => f.resolve(provider as "mock" | "demo"), reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    expect((await team.run(f.options, signal)).blocked).toBeUndefined(); expect(team.snapshot.status).toBe("partial");
  });
  it("prepares a connection once before starting member deadlines, without treating preparation as model usage", async () => {
    const f = fixture(); const signal = new AbortController().signal; let release!: () => void; let prepared = 0;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const client: ModelClient = { ...f.resolve("mock"), prepare: async () => { prepared++; await ready; } };
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    const work = team.run(f.options, signal);
    try { await new Promise(resolve => setTimeout(resolve, 5)); expect(f.seen).toHaveLength(0); expect(team.snapshot.modelTurns).toBe(0); expect(prepared).toBe(1); }
    finally { release(); await work; }
    expect(team.snapshot.modelTurns).toBe(5);
  });
  it("cascades stop to active members and never starts a queued member or lead afterwards", async () => {
    const f = fixture(); const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let memberCalls = 0;
    const client: ModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(prompt, signal, options) {
      if (options?.messages?.some(item => item.content.includes("TEAM_MEMBER"))) { memberCalls++; started(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); }
      yield* f.resolve("mock").stream(prompt, signal, options);
    } };
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team", maxConcurrency: 1 }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, abort.signal);
    const running = team.run(f.options, abort.signal); await ready; abort.abort(); await expect(running).rejects.toThrow();
    expect(memberCalls).toBe(1); expect(team.snapshot.status).toBe("interrupted"); expect(team.snapshot.members.every(member => member.status === "cancelled")).toBe(true);
    expect(team.snapshot.review?.status).toBe("interrupted");
    expect(f.seen.some(item => item.purpose === "lead")).toBe(false);
  });
  it("shares history only with explicit consent, retaining independent member views", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team", shareContext: true }), provider: "mock", resolve: () => f.resolve("mock"), reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    await team.run(f.options, signal);
    for (const item of f.seen.filter(item => item.purpose === "member")) { expect(JSON.stringify(item.messages)).toContain("SECRET"); expect(JSON.stringify(item.messages)).not.toContain("MEMBER_RESULT"); }
  });
  it("plans once, isolates members, sends attributed untrusted results to the lead and persists before dispatch", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock", resolve: () => f.resolve("mock"), reasoning: "balanced", scope: "scope", question: f.options.question, save: f.save }, signal);
    const result = await team.run(f.options, signal);
    expect(result.blocked).toBeUndefined(); expect(team.snapshot.status).toBe("completed");
    expect(f.seen.map(item => item.purpose)).toEqual(["plan", "member", "member", "review", "lead"]);
    for (const item of f.seen.filter(item => item.purpose === "member")) { expect(JSON.stringify(item.messages)).not.toContain("SECRET"); expect(JSON.stringify(item.messages)).not.toContain("MEMBER_RESULT"); }
    expect(f.seen.at(-1)?.messages.some(item => item.role === "observation" && item.content.includes("MEMBER_RESULT"))).toBe(true);
    expect(f.saved.some(item => item.members.every(member => member.status === "queued"))).toBe(true);
    expect(team.snapshot.members.every(member => member.attempts === 1)).toBe(true);
  });
  it("keeps failed required members partial and never reissues completed or interrupted children on recovery", async () => {
    const f = fixture(true); const signal = new AbortController().signal;
    const config = teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "demo" }] });
    const input = { config, provider: "mock" as const, resolve: (provider: string) => f.resolve(provider as "mock" | "demo"), reasoning: "balanced" as const, scope: "scope", question: f.options.question, save: f.save };
    const team = await TeamCoordinator.create(input, signal); expect((await team.run(f.options, signal)).blocked).toBe(true); expect(team.snapshot.status).toBe("partial");
    const previous = structuredClone(team.snapshot); previous.members[0]!.status = "running";
    const count = f.seen.filter(item => item.purpose === "member").length;
    const restored = await TeamCoordinator.create({ ...input, previous }, signal); await restored.run(f.options, signal);
    expect(f.seen.filter(item => item.purpose === "member")).toHaveLength(count); expect(restored.snapshot.members[0]!.status).toBe("interrupted");
    await expect(TeamCoordinator.create({ ...input, previous, scope: "revoked" }, signal)).rejects.toThrow("team_scope_changed");
  });
});
