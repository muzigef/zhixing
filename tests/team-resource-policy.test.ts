import { expect, it } from "vitest";
import { memberResourcePolicy } from "../src/team-resource-policy.js";
import { adapterCapabilities } from "../src/model-capabilities.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";

const capabilities = { ...adapterCapabilities(true, "configurable"), reasoningBudget: "shared-output" as const };
const config = teamConfigurationSchema.parse({ mode: "mixed-model-team" });
it("chooses a bounded automatic effort when reasoning shares a small output budget", () => {
  expect(memberResourcePolicy(config, capabilities, "balanced", config.members[0]!)).toMatchObject({ reasoning: "quick", maxOutputTokens: 4096, reasoningSource: "budget-aware", budgetLimited: false });
  expect(memberResourcePolicy(config, capabilities, "deep", config.members[0]!)).toMatchObject({ reasoning: "quick", reasoningSource: "budget-aware" });
});
it("retains the requested effort when the whole team can afford its output target", () => {
  const larger = teamConfigurationSchema.parse({ mode: "mixed-model-team", maxOutputTokens: 24576 });
  expect(memberResourcePolicy(larger, capabilities, "balanced", larger.members[0]!)).toMatchObject({ reasoning: "balanced", maxOutputTokens: 8192, reasoningSource: "inherited" });
});
it("honors manual effort and token caps while making insufficient global capacity explicit", () => {
  expect(memberResourcePolicy(config, capabilities, "balanced", { ...config.members[0]!, reasoning: "deep" })).toMatchObject({ reasoning: "deep", maxOutputTokens: 4608, reasoningSource: "explicit", budgetLimited: true });
  expect(memberResourcePolicy(config, capabilities, "balanced", { ...config.members[0]!, maxOutputTokens: 1024 })).toMatchObject({ reasoning: "quick", maxOutputTokens: 1024, budgetLimited: true });
});
it("uses declared protocol capabilities rather than model-name guesses and preserves unknown backends", () => {
  expect(memberResourcePolicy(config, adapterCapabilities(false), "deep", config.members[0]!)).toBeUndefined();
  expect(memberResourcePolicy(config, { ...capabilities, maxOutputTokens: 2048 }, "balanced", config.members[0]!)).toMatchObject({ reasoning: "quick", maxOutputTokens: 2048, budgetLimited: true });
});
it("reserves planning, review and final answer capacity before splitting member budgets", () => {
  for (const total of [2048, 4096, 8000, 16384, 24576, 48000]) {
    const current = teamConfigurationSchema.parse({ mode: "mixed-model-team", maxOutputTokens: total });
    const selected = current.members.map(m => memberResourcePolicy(current, capabilities, "deep", { ...m, reasoning: "deep", maxOutputTokens: 8192 })!);
    const reserve = Math.min(1024, Math.floor(total / 16)) + Math.min(2048, Math.floor(total / 8)) + Math.min(4096, Math.floor(total / 2));
    expect(selected.reduce((sum, m) => sum + m.maxOutputTokens, reserve)).toBeLessThanOrEqual(total);
  }
});

// Actual API adapters with synthetic responses: budget selection must reach the wire,
// preserve explicit settings and survive restart without reading real credentials.
import { DeepSeekClient } from "../src/deepseek-client.js";
import { KimiClient } from "../src/kimi-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { TeamCoordinator } from "../src/team-coordinator.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { fixtureTeamReport, fixtureTeamReview } from "./team-fixtures.js";
import type { ModelClient } from "../src/model.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function fixture() {
  const secrets = new MemorySecretStore();
  await secrets.set("keychain:zhixing/deepseek-api", "fixture-resource-deepseek");
  await secrets.set("keychain:zhixing/kimi-api", "fixture-resource-kimi");
  const calls: { model: string; max_tokens: number; thinking?: { type: string }; reasoning_effort?: string }[] = [];
  const fetcher = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push(body);
    const exhausted = body.max_tokens < 8192 && (body.thinking?.type === "enabled" || body.reasoning_effort === "high");
    return new Response(JSON.stringify({ choices: [{ message: exhausted ? { reasoning_content: "private synthetic reasoning" } : { content: fixtureTeamReport }, finish_reason: exhausted ? "length" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: exhausted ? 4096 : 80, completion_tokens_details: { reasoning_tokens: exhausted ? 4096 : 10 } } }));
  };
  const lead: ModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(_prompt, _signal, request) {
    const phase = request?.messages?.find(m => m.role === "system" && /^TEAM_/.test(m.content))?.content;
    yield { type: "text_delta", text: phase?.startsWith("TEAM_PLAN") ? '{"tasks":["计算","独立核对"]}' : phase?.startsWith("TEAM_REVIEW") ? fixtureTeamReview : "核查后答案为 4。" };
    yield { type: "usage", usage: { inputTokens: 50, outputTokens: 50 } }; yield { type: "done" };
  } };
  const deepseek = new DeepSeekClient(secrets, fetcher, {}), kimi = new KimiClient(secrets, fetcher, {});
  const resolve = (provider: string) => provider === "deepseek-api" ? deepseek : provider === "kimi-api" ? kimi : lead;
  const config = teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "deepseek-api" }, { role: "material-checker", provider: "kimi-api" }] });
  return { calls, resolve, config };
}
it("prevents reasoning starvation on the actual two API request shapes and persists v13 policies", async () => {
  const f = await fixture(); const root = await fs.mkdtemp(path.join(os.tmpdir(), "team-resource-test-"));
  const store = new AgentSessionStore(root), service = new AgentService(store, f.resolve);
  try {
    const session = await service.create();
    const reply = await service.invoke({ sessionId: session.id, provider: "mock", style: "adaptive", reasoning: "balanced", text: "2+2?", collaboration: f.config });
    await service.pauseMaintenance();
    expect(reply.team?.status).toBe("completed");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toMatchObject({ thinking: { type: "disabled" }, max_tokens: 4096 });
    expect(f.calls[0]?.reasoning_effort).toBeUndefined();
    expect(f.calls[1]).toMatchObject({ reasoning_effort: "low", max_tokens: 4096 });
    expect(f.calls[1]?.thinking).toBeUndefined();
    const loaded = await new AgentSessionStore(root).load(session.id);
    expect(loaded.version).toBe(13);
    expect(loaded.messages.at(-1)?.team?.members.map(m => m.resourcePolicy?.reasoningSource)).toEqual(["budget-aware", "budget-aware"]);
    expect(JSON.parse(await fs.readFile(path.join(root, "conversations", `${session.id}.json.v8.bak`), "utf8")).version).toBe(8);
    await expect(store.save({ ...loaded, version: 12, messages: [], collaboration: undefined })).rejects.toThrow("storage_version_unsupported");
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
it("does not silently replace explicit balanced settings, and keeps the resulting failure visible", async () => {
  const f = await fixture(); const root = await fs.mkdtemp(path.join(os.tmpdir(), "team-resource-manual-"));
  const service = new AgentService(new AgentSessionStore(root), f.resolve);
  try {
    const session = await service.create();
    const config = teamConfigurationSchema.parse({ ...f.config, members: f.config.members.map(m => ({ ...m, reasoning: "balanced", maxOutputTokens: 4096 })) });
    const reply = await service.invoke({ sessionId: session.id, provider: "mock", style: "adaptive", reasoning: "balanced", text: "2+2?", collaboration: config });
    expect(reply.team?.status).toBe("partial");
    expect(reply.team?.members.every(m => m.binding.reasoning === "balanced" && m.failureCode === "output_limit" && m.resourcePolicy?.budgetLimited)).toBe(true);
    expect(f.calls).toHaveLength(2); // No hidden retry or effort downgrade.
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
it("reuses saved policies and legacy effort on recovery even if current capabilities differ", async () => {
  const f = await fixture(); const input = { config: f.config, provider: "mock" as const, resolve: f.resolve, reasoning: "balanced" as const, scope: "scope", question: "2+2?", save: async () => {} };
  const team = await TeamCoordinator.create(input, new AbortController().signal);
  const previous = structuredClone(team.snapshot);
  const restored = await TeamCoordinator.create({ ...input, previous, resolve: provider => ({ ...f.resolve(provider), capabilities: adapterCapabilities(true), stream: f.resolve(provider).stream.bind(f.resolve(provider)), identity: f.resolve(provider).identity }) }, new AbortController().signal);
  expect(restored.snapshot.members.map(m => m.resourcePolicy)).toEqual(previous.members.map(m => m.resourcePolicy));
  for (const m of previous.members) { delete m.resourcePolicy; m.binding.reasoning = "balanced"; }
  const legacy = await TeamCoordinator.create({ ...input, previous }, new AbortController().signal);
  expect(legacy.snapshot.members.every(m => m.binding.reasoning === "balanced" && m.resourcePolicy === undefined)).toBe(true);
});

it("provides full 8192-token member requests when a larger explicit team budget permits them", async () => {
  const f = await fixture(); const root = await fs.mkdtemp(path.join(os.tmpdir(), "team-resource-larger-"));
  const service = new AgentService(new AgentSessionStore(root), f.resolve);
  try {
    const session = await service.create();
    const reply = await service.invoke({ sessionId: session.id, provider: "mock", style: "adaptive", reasoning: "balanced", text: "2+2?", collaboration: { ...f.config, maxOutputTokens: 24576 } });
    expect(reply.team?.status).toBe("completed");
    expect(reply.team?.members.every(m => m.binding.reasoning === "balanced" && m.resourcePolicy?.maxOutputTokens === 8192)).toBe(true);
    expect(f.calls).toHaveLength(2); expect(f.calls.every(call => call.max_tokens === 8192)).toBe(true);
    expect(f.calls[0]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
    expect(f.calls[1]).toMatchObject({ reasoning_effort: "high" });
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
it("selects the highest requested automatic effort that fits without treating deep as balanced", () => {
  const middle = teamConfigurationSchema.parse({ ...config, maxOutputTokens: 24576 });
  expect(memberResourcePolicy(middle, capabilities, "deep", middle.members[0]!)).toMatchObject({ reasoning: "balanced", maxOutputTokens: 8192, reasoningSource: "budget-aware" });
  const large = teamConfigurationSchema.parse({ ...config, maxOutputTokens: 48000 });
  expect(memberResourcePolicy(large, capabilities, "deep", large.members[0]!)).toMatchObject({ reasoning: "deep", maxOutputTokens: 16384, reasoningSource: "inherited" });
  expect(teamConfigurationSchema.parse({ ...large, members: [{ role: "reasoning-checker", maxOutputTokens: 16384 }] }).members[0]?.maxOutputTokens).toBe(16384);
});
