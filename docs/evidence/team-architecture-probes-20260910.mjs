// Architecture diagnostics, not desired-behavior regression tests or model-quality scores.
// Run from the repository root with: node --import tsx docs/evidence/team-architecture-probes-20260910.mjs
// Uses only in-memory mock/demo clients. No provider, credential, workspace or network access.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TeamCoordinator } from "../../src/team-coordinator.ts";
import { teamConfigurationSchema } from "../../src/team-contracts.ts";

const marker = "SYNTHETIC_PRIOR_CONDITION: 先前约定方案甲只处理偶数输入。";
async function scenario(kind, previous) {
  const calls = [];
  const config = teamConfigurationSchema.parse(kind.startsWith("optional-")
    ? { mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "demo", required: false }, { role: "material-checker", provider: "mock" }] }
    : { mode: "same-model-team", shareContext: kind === "context", maxConcurrency: 1 });
  const resolve = provider => ({
    identity: { provider, model: `synthetic-${provider}`, connection: `synthetic:${provider}` },
    async prepare() { if (kind === "optional-prepare" && provider === "demo") throw new Error("synthetic_prepare_failure"); },
    async *stream(_prompt, _signal, options) {
      const messages = options?.messages ?? [];
      const system = messages.filter(item => item.role === "system").map(item => item.content).join("\n");
      const phase = ["PLAN", "FOLLOWUP", "MEMBER", "REVIEW"].find(item => system.includes(`TEAM_${item}`)) ?? "FINAL";
      calls.push({ phase, provider, receivesPriorCondition: JSON.stringify(messages).includes(marker) });
      if (kind === "optional-member" && provider === "demo" && phase === "MEMBER") throw new Error("synthetic_member_failure");
      if (kind === "resume" && phase === "REVIEW") throw new Error("synthetic_review_failure");
      const report = { summary: "合成报告：关键条件仍需核查。", claims: [{ key: "condition", value: "尚待核对", basis: "本夹具只验证编排状态，不提供事实证明。" }], uncertainties: ["关键条件尚未证实。"] };
      const review = { verdict: kind === "uncertain" ? "uncertain" : kind === "followup" ? "needs-check" : "ready", issues: ["uncertain", "followup"].includes(kind) ? ["关键条件缺少证明。"] : [], guidance: "合成审查意见，不是正确性认证。", followUp: kind === "followup" ? { member: 1, question: "核对仍未证实的关键条件。" } : null };
      const text = phase === "PLAN" ? JSON.stringify({ tasks: config.members.map(() => "核对指定条件。") }) : ["MEMBER", "FOLLOWUP"].includes(phase) ? JSON.stringify(report) : phase === "REVIEW" ? JSON.stringify(review) : "合成回答：关键条件仍未证实。";
      yield { type: "text_delta", text };
      yield { type: "usage", usage: { inputTokens: 50, outputTokens: 50 } };
      yield { type: "done" };
    },
  });
  const question = "继续核对刚才的方案甲。";
  const signal = new AbortController().signal;
  const team = await TeamCoordinator.create({ config, provider: "mock", resolve, reasoning: "balanced", scope: "synthetic-scope", question, previous, save: async () => {} }, signal);
  let result, error;
  try {
    result = await team.run({ runId: randomUUID(), providerId: "mock", client: resolve("mock"), question, prompt: question, messages: [{ role: "user", content: marker }, { role: "user", content: question }], reasoning: "balanced", contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {} }, signal);
  } catch (problem) { error = problem.message; }
  return { calls, result, error, snapshot: structuredClone(team.snapshot) };
}

const prepare = await scenario("optional-prepare");
assert.equal(prepare.error, "synthetic_prepare_failure");
assert.equal(prepare.snapshot.status, "failed");
assert.equal(prepare.calls.length, 0);
const member = await scenario("optional-member");
assert.equal(member.snapshot.status, "partial");
assert.equal(member.result.blocked, undefined);
assert.ok(member.calls.some(call => call.phase === "FINAL"));
const uncertain = await scenario("uncertain");
assert.equal(uncertain.snapshot.review.verdict, "uncertain");
assert.equal(uncertain.snapshot.status, "completed");
assert.equal(uncertain.result.blocked, undefined);
const followup = await scenario("followup");
assert.equal(followup.snapshot.review.followUp.report.uncertainties.length, 1);
assert.equal(followup.snapshot.status, "completed");
assert.equal(followup.calls.filter(call => call.phase === "REVIEW").length, 1);
const context = await scenario("context");
assert.ok(context.calls.filter(call => call.phase === "MEMBER").every(call => call.receivesPriorCondition));
assert.ok(context.calls.filter(call => ["PLAN", "REVIEW"].includes(call.phase)).every(call => !call.receivesPriorCondition));
const interrupted = await scenario("resume");
assert.equal(interrupted.snapshot.review.status, "failed");
const resumed = await scenario("resume", interrupted.snapshot);
assert.deepEqual(resumed.calls.map(call => call.phase), ["FINAL"]);
assert.equal(resumed.snapshot.status, "partial");
assert.equal(resumed.result.blocked, true);

const paths = ["src/team-coordinator.ts", "src/team-contracts.ts", "src/team-quality.ts", "src/team-budget.ts", "src/assistant-runtime.ts", "src/model-invocation.ts"];
const files = await Promise.all(paths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex") })));
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(), kind: "current_architecture_diagnostics", liveRequests: 0, fileHashes: files,
  interpretation: "Assertions reproduce current mechanics; success does not certify desired behavior or real-model quality.",
  probes: [
    { id: "AP01", finding: "optional preparation failure aborts all dispatch", status: prepare.snapshot.status, modelCalls: prepare.calls.length },
    { id: "AP02", finding: "optional member execution failure permits the final answer", status: member.snapshot.status, blocked: Boolean(member.result.blocked), calls: member.calls },
    { id: "AP03", finding: "uncertain review does not prevent execution completion", status: uncertain.snapshot.status, verdict: uncertain.snapshot.review.verdict, issues: uncertain.snapshot.review.issues, blocked: Boolean(uncertain.result.blocked) },
    { id: "AP04", finding: "unresolved follow-up has no second closure gate", status: followup.snapshot.status, verdict: followup.snapshot.review.verdict, uncertainties: followup.snapshot.review.followUp.report.uncertainties, calls: followup.calls },
    { id: "AP05", finding: "shared history reaches members but not planner or reviewer", shareContext: true, calls: context.calls },
    { id: "AP06", finding: "resume uses saved reports but does not rerun failed verification", status: resumed.snapshot.status, reviewStatus: resumed.snapshot.review.status, blocked: Boolean(resumed.result.blocked), calls: resumed.calls },
  ],
}, null, 2));
