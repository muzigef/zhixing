import { expect, it } from "vitest";
import { TeamCoordinator } from "../src/team-coordinator.js";
import { teamConfigurationSchema, type TeamSnapshot } from "../src/team-contracts.js";
import type { ModelClient, ModelMessage } from "../src/model.js";
import { parseTeamJson, teamJsonRepairReason, teamReportSchema } from "../src/team-quality.js";
import type { AgentProvider } from "../src/agent-provider.js";
import { capabilitiesFor } from "../src/model-capabilities.js";
import { imageContext, imageFromBytes } from "../src/image-input.js";

const report = (value: string) => JSON.stringify({ summary: `候选结论 ${value}`, claims: [{ key: "answer", value, basis: "从题目给定条件逐项核算。" }], uncertainties: [] });
it("inherits lead effort for all new members, preserving explicit and previously frozen choices", async () => {
  const f = fixture(); const signal = new AbortController().signal;
  const resolve = (provider: AgentProvider): ModelClient => ({ ...f.options.client, identity: { provider, model: provider, connection: "local" } });
  const config = teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "deepseek-api" }, { role: "material-checker", provider: "kimi-api", reasoning: "balanced" }] });
  const input = { ...f.input, config, resolve }; const team = await TeamCoordinator.create(input, signal);
  expect(team.snapshot.members.map(member => member.binding.reasoning)).toEqual(["balanced", "balanced"]);
  const prior = structuredClone(team.snapshot); prior.members[0]!.binding.reasoning = "quick";
  const restored = await TeamCoordinator.create({ ...input, previous: prior }, signal);
  expect(restored.snapshot.members[0]?.binding.reasoning).toBe("quick");
  const deep = await TeamCoordinator.create({ ...input, reasoning: "deep" }, signal);
  expect(deep.snapshot.members.map(member => member.binding.reasoning)).toEqual(["deep", "balanced"]);
});
function fixture(conflict = false, failure?: string) {
  const calls: { kind: string; messages: readonly ModelMessage[]; maxOutputTokens?: number }[] = []; const saved: TeamSnapshot[] = [];
  const client: ModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(_prompt, _signal, options) {
    const messages = options?.messages ?? []; const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const kind = ["PLAN", "FOLLOWUP", "MEMBER", "REVIEW"].find(value => system.includes(`TEAM_${value}`)) ?? "FINAL";
    calls.push({ kind, messages, maxOutputTokens: options?.maxOutputTokens });
    if (kind === "MEMBER" && failure) throw new Error(failure);
    const value = kind === "PLAN" ? '{"tasks":["独立计算","从反例和边界检查"]}' : kind === "MEMBER" ? report(conflict && calls.filter(x => x.kind === "MEMBER").length === 2 ? "5" : "4") : kind === "FOLLOWUP" ? report("4") : kind === "REVIEW" ? JSON.stringify({ verdict: conflict ? "needs-check" : "ready", issues: conflict ? ["候选 answer 分别为 4 与 5，需重新代入原条件"] : [], guidance: "以原条件计算为依据，不按多数票决定。", followUp: conflict ? { member: 2, question: "重新代入原条件核对 answer，解释差异。" } : null }) : "最终结果为 4。";
    yield { type: "text_delta", text: value }; yield { type: "usage", usage: { inputTokens: 80, outputTokens: 50 } }; yield { type: "done" };
  } };
  const options = { runId: crypto.randomUUID(), providerId: "mock", client, prompt: "PRIVATE_HISTORY", question: "只能使用两段资料求 2+2，只输出 JSON。", messages: [{ role: "user", content: "PRIVATE_HISTORY" }, { role: "user", content: "只能使用两段资料求 2+2，只输出 JSON。" }] as ModelMessage[], contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {} };
  const input = { config: teamConfigurationSchema.parse({ mode: "same-model-team" }), provider: "mock" as const, resolve: () => client, reasoning: "balanced" as const, scope: "test-scope", question: options.question, save: async (state: TeamSnapshot) => { saved.push(structuredClone(state)); } };
  return { calls, saved, options, input };
}
it("runs independent structured reports and a separate review without leaking history or peer answers into the first round", async () => {
  const f = fixture(); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create(f.input, signal); await team.run(f.options, signal);
  expect(f.calls.map(x => x.kind)).toEqual(["PLAN", "MEMBER", "MEMBER", "REVIEW", "FINAL"]);
  for (const call of f.calls.filter(x => ["MEMBER", "REVIEW"].includes(x.kind))) expect(JSON.stringify(call.messages)).not.toContain("PRIVATE_HISTORY");
  for (const call of f.calls.filter(x => x.kind === "MEMBER")) expect(JSON.stringify(call.messages)).not.toContain("候选结论 4");
  expect(team.snapshot.members.every(m => m.report?.claims[0]?.value === "4")).toBe(true);
  expect(team.snapshot.review).toMatchObject({ status: "completed", verdict: "ready" });
});
it("performs at most one targeted follow-up, preserves first-round disagreement, and passes both records to final synthesis", async () => {
  const f = fixture(true); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create(f.input, signal); await team.run(f.options, signal);
  expect(f.calls.map(x => x.kind)).toEqual(["PLAN", "MEMBER", "MEMBER", "REVIEW", "FOLLOWUP", "REVIEW", "FINAL"]);
  expect(team.snapshot.members[1]?.report?.claims[0]?.value).toBe("5");
  expect(team.snapshot.review?.followUp).toMatchObject({ status: "completed", member: 2, report: { claims: [{ key: "answer", value: "4" }] } });
  const followup = f.calls.find(x => x.kind === "FOLLOWUP")!;
  expect(JSON.stringify(followup.messages)).not.toContain("PRIVATE_HISTORY");
  expect(JSON.stringify(f.calls.at(-1)?.messages)).toContain("重新代入原条件");
  expect(f.saved.some(s => s.review?.followUp?.status === "running")).toBe(true);
});
it("stores a safe failure code without persisting arbitrary provider error text", async () => {
  const f = fixture(false, "provider_unavailable: deepseek HTTP 429"); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create(f.input, signal); await team.run(f.options, signal);
  expect(team.snapshot.members[0]?.failureCode).toBe("rate_limit");
  const other = fixture(false, "private-upstream-value"); const failed = await TeamCoordinator.create(other.input, signal); await failed.run(other.options, signal);
  expect(failed.snapshot.members[0]?.failureCode).toBe("unknown");
  expect(JSON.stringify(failed.snapshot)).not.toContain("private-upstream-value");
});
it("never replays an interrupted review or follow-up on resume", async () => {
  const f = fixture(true); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create(f.input, signal); await team.run(f.options, signal);
  const previous = structuredClone(team.snapshot); previous.review!.followUp!.status = "running";
  const count = f.calls.length;
  const recovered = await TeamCoordinator.create({ ...f.input, previous }, signal); await recovered.run(f.options, signal);
  expect(f.calls.slice(count).map(x => x.kind)).toEqual(["FINAL"]);
  expect(recovered.snapshot.review?.followUp?.status).toBe("interrupted");
  expect(recovered.snapshot.status).toBe("partial");
});
it("rejects duplicate claims, unbounded output and extra protocol text instead of silently truncating evidence", () => {
  const value = JSON.parse(report("4")); value.claims.push({ ...value.claims[0] });
  for (const text of [JSON.stringify(value), report("4") + " extra text", "x".repeat(8001)]) expect(() => parseTeamJson(teamReportSchema, text)).toThrow("team_report_invalid");
  expect(parseTeamJson(teamReportSchema, '```json\n' + report("4") + '\n```').claims[0]?.value).toBe("4");
});
it("repairs a malformed completed member report once using its own isolated continuation", async () => {
  const f = fixture(); let repairs = 0; let first = true; const original = f.options.client;
  const client: ModelClient = { ...original, async *stream(prompt, signal, options) {
    if (first && options?.messages?.some(x => x.content.includes("TEAM_MEMBER"))) { first = false; yield { type: "text_delta", text: '{"summary":"missing required fields"}' }; yield { type: "usage", usage: { inputTokens: 2, outputTokens: 2 } }; yield { type: "done" }; }
    else yield* original.stream(prompt, signal, options);
  }, ...{ async *continue(_prompt: string, _results: unknown, _signal: AbortSignal, options?: { history?: unknown }) {
    repairs++; expect(JSON.stringify(options?.history)).toContain("missing required fields"); expect(JSON.stringify(options?.history)).not.toContain("PRIVATE_HISTORY");
    yield { type: "text_delta" as const, text: report("4") }; yield { type: "done" as const };
  } } };
  const team = await TeamCoordinator.create({ ...f.input, resolve: () => client }, new AbortController().signal);
  await team.run({ ...f.options, client }, new AbortController().signal);
  expect(repairs).toBe(1); expect(team.snapshot.members.every(member => member.status === "completed")).toBe(true);
});
it("lets the main answer finish when review has no budget, but records the incomplete protocol", async () => {
  const f = fixture(); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create({ ...f.input, config: teamConfigurationSchema.parse({ mode: "same-model-team", maxConcurrency: 1, maxModelTurns: 5, maxOutputTokens: 4096 }) }, signal);
  const result = await team.run(f.options, signal);
  expect(f.calls.at(-1)?.kind).toBe("FINAL"); expect(result.blocked).toBe(true);
  expect(team.snapshot.review).toMatchObject({ status: "failed", failureCode: "budget" });
  expect(team.snapshot.modelTurns).toBeLessThanOrEqual(5); expect(team.snapshot.reservedOutputTokens).toBeLessThanOrEqual(4096);
});
it("supports stopping a follow-up without erasing the original completed member report", async () => {
  const f = fixture(true); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const original = f.options.client; const client: ModelClient = { ...original, async *stream(prompt, signal, options) {
    if (options?.messages?.some(m => m.role === "system" && m.content.includes("TEAM_FOLLOWUP"))) { started(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); }
    yield* original.stream(prompt, signal, options);
  } };
  const signal = new AbortController().signal; const team = await TeamCoordinator.create({ ...f.input, resolve: () => client }, signal);
  const work = team.run({ ...f.options, client }, signal); await ready;
  await team.stopMember(team.snapshot.members[1]!.id); const result = await work;
  expect(team.snapshot.members[1]?.report?.claims[0]?.value).toBe("5");
  expect(team.snapshot.review?.followUp).toMatchObject({ status: "failed", failureCode: "cancelled" });
  expect(result.blocked).toBe(true); expect(f.calls.at(-1)?.kind).toBe("FINAL");
});
it("shares the same explicitly authorized packet with targeted members and review", async () => {
  const f = fixture(true); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create({ ...f.input, config: teamConfigurationSchema.parse({ mode: "same-model-team", shareContext: true }) }, signal);
  await team.run(f.options, signal);
  expect(JSON.stringify(f.calls.find(call => call.kind === "FOLLOWUP")?.messages)).toContain("PRIVATE_HISTORY");
  expect(JSON.stringify(f.calls.find(call => call.kind === "REVIEW")?.messages)).toContain("PRIVATE_HISTORY");
});

it("treats the original answer format as task data in all internal stages while preserving the lead request", async () => {
  const f = fixture(true); const signal = new AbortController().signal;
  const team = await TeamCoordinator.create(f.input, signal); await team.run(f.options, signal);
  for (const call of f.calls.filter(item => item.kind !== "FINAL")) {
    expect(call.messages.at(-1)).toMatchObject({ role: "user" });
    expect(call.messages.at(-1)?.content).toContain("内部 JSON");
    expect(call.messages.some(item => item.role === "observation" && item.content.includes(f.options.question))).toBe(true);
    expect(call.messages.some(item => item.role === "user" && item.content.includes(f.options.question))).toBe(false);
  }
  expect(f.calls.at(-1)?.messages.at(-1)).toEqual(f.options.messages.at(-1));
});

it("gives bounded field-specific repair feedback without copying model values or unknown field names", () => {
  const bad = JSON.parse(report("4")); bad.claims[0].value = 4; bad["PRIVATE_MODEL_VALUE"] = "PRIVATE_MODEL_VALUE";
  const reason = teamJsonRepairReason(teamReportSchema, JSON.stringify(bad));
  expect(reason).toContain("claims.0.value"); expect(reason).toContain("string");
  expect(reason).not.toContain("PRIVATE_MODEL_VALUE"); expect(reason!.length).toBeLessThanOrEqual(500);
  expect(teamJsonRepairReason(teamReportSchema, report("4"))).toBeUndefined();
  expect(teamJsonRepairReason(teamReportSchema, "PRIVATE_MODEL_VALUE")).toContain("JSON");
  expect(teamJsonRepairReason(teamReportSchema, "x".repeat(8001))).toContain("8000");
  bad.claims[0].value = "4"; delete bad["PRIVATE_MODEL_VALUE"]; bad.claims.push({ ...bad.claims[0] });
  expect(teamJsonRepairReason(teamReportSchema, JSON.stringify(bad))).toBeDefined();
});

it("repairs internal reports using their own contract instead of the final user answer format", async () => {
  const f = fixture(); const original = f.options.client; let repairs = 0;
  const client: ModelClient = { ...original, async *stream(prompt, signal, options) {
    if (options?.messages?.some(item => item.role === "system" && item.content.includes("TEAM_MEMBER"))) {
      yield { type: "text_delta", text: '{"summary":"candidate","claims":[{"key":"answer","value":4,"basis":"2+2"}],"uncertainties":[]}' }; yield { type: "usage", usage: { inputTokens: 80, outputTokens: 50 } }; yield { type: "done" };
    } else yield* original.stream(prompt, signal, options);
  }, ...{ async *continue(_prompt: string, _results: unknown, _signal: AbortSignal, options?: { history?: { feedback?: string }[] }) {
    repairs++; const feedback = options?.history?.at(-1)?.feedback ?? "";
    expect(feedback).toContain("claims.0.value"); expect(feedback).toContain("内部 JSON");
    expect(feedback).not.toContain("仍需遵守用户篇幅和格式要求");
    yield { type: "text_delta" as const, text: report("4") }; yield { type: "usage" as const, usage: { inputTokens: 80, outputTokens: 50 } }; yield { type: "done" as const };
  } } };
  const signal = new AbortController().signal;
  const team = await TeamCoordinator.create({ ...f.input, resolve: () => client }, signal);
  const result = await team.run({ ...f.options, client }, signal);
  expect(repairs).toBe(2); expect(team.snapshot.members.every(member => member.status === "completed")).toBe(true);
  expect(result.blocked).toBeUndefined();
});

it("preserves images through every internal stage using the supported user-image wire contract", async () => {
  const f = fixture(true); const original = f.options.client;
  const picture = imageFromBytes("synthetic.png", Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=", "base64")));
  const client: ModelClient = { ...original, capabilities: { ...capabilitiesFor(original), inputModalities: ["text", "image"] }, async *stream(prompt, signal, options) {
    imageContext(options?.messages ?? []); yield* original.stream(prompt, signal, options);
  } };
  const options = { ...f.options, client, messages: [{ role: "user" as const, content: f.options.question, images: [picture] }] };
  const signal = new AbortController().signal;
  const team = await TeamCoordinator.create({ ...f.input, resolve: () => client, images: [picture] }, signal);
  const result = await team.run(options, signal);
  expect(result.blocked).toBeUndefined(); expect(team.snapshot.status).toBe("completed");
  expect(f.calls.map(call => call.kind)).toEqual(["PLAN", "MEMBER", "MEMBER", "REVIEW", "FOLLOWUP", "REVIEW", "FINAL"]);
  for (const call of f.calls) {
    const images = call.messages.filter(message => message.images?.length);
    expect(images).toHaveLength(1); expect(images[0]).toMatchObject({ role: "user", images: [picture] });
    if (call.kind !== "FINAL") expect(call.messages.at(-1)?.content).toContain("内部 JSON");
  }
});
