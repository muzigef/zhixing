import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeAgentExecutor, nativeEnvironment, runNativeProcess, type NativeCommand, type NativeRunner } from "../src/native-agent.js";
import { executeAgent } from "../src/agent-executor.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { DesktopService } from "../desktop/core/service.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";
import { MockModelClient } from "../src/model.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAssistantTask } from "../src/assistant-runtime.js";
const flags = "--restricted --safe-mode --tools --strict-mcp-config --no-session-persistence --setting-sources --system-prompt-file";
const signal = () => new AbortController().signal;
function fixture(options: { tools?: boolean; auth?: string; truncated?: boolean; old?: boolean; result?: string | string[]; failExit?: boolean } = {}) {
  const commands: NativeCommand[] = [];
  let answers = 0;
  const runner: NativeRunner = async (command, _signal, line) => {
    commands.push(command);
    if (command.args.includes("--help")) { line(options.old ? "old CLI" : flags); return; }
    if (command.args[0] === "auth") { line(JSON.stringify({ loggedIn: true, authMethod: options.auth ?? "claude.ai" })); return; }
    if (options.tools) { line(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } })); return; }
    const text = (Array.isArray(options.result) ? options.result[answers++] : options.result) ?? "合成教学回答";
    line(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }));
    if (!options.truncated) line(JSON.stringify({ type: "result", subtype: "success", result: text, num_turns: 1 }));
    if (options.failExit) throw new Error("native_runtime_failed");
  };
  return { commands, executor: new NativeAgentExecutor("claude", { HOME: "/synthetic-home", PATH: "/synthetic-bin", ANTHROPIC_API_KEY: "fixture-not-inherited", CLAUDE_CODE_OAUTH_TOKEN: "fixture-not-inherited" }, runner, "/synthetic/claude") };
}
it("keeps native execution separate from model calls, preserves roles and reports unknown usage", async () => {
  const { executor, commands } = fixture(); let output = "";
  const result = await executeAgent(executor, { prompt: "fallback", messages: [{ role: "system", content: "教学规则" }, { role: "assistant", content: "之前的回答" }, { role: "user", content: "当前问题" }] }, signal(), text => { output += text; });
  expect(output).toBe("合成教学回答"); expect(result).toMatchObject({ verification: "unverified", runtimeTurns: 1 }); expect(result.usage).toBeUndefined();
  expect("stream" in executor).toBe(false);
  const command = commands.find(command => command.args.includes("--print"))!;
  expect(command.input).toContain('"role":"assistant"'); expect(command.input).not.toContain("fallback");
  expect(command.args).toEqual(expect.arrayContaining(["--safe-mode", "--restricted", "--tools", "", "--disallowedTools", "*", "--no-session-persistence"]));
  expect(command.environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  expect(command.environment).not.toHaveProperty("ANTHROPIC_API_KEY"); expect(command.environment).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  await expect(fs.stat(command.cwd)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each([true, false])("applies the shared response check to native answers with one bounded repair: fixed=%s", async fixed => {
  const { executor, commands } = fixture({ result: ["missing evidence", fixed ? "checked answer" : "still missing evidence"] });
  const onTurn = vi.fn();
  const result = await runAssistantTask({ runId: "native-check", providerId: "native-claude", client: executor, prompt: "合成问题", question: "合成问题", contextAllowed: false, onText: () => {}, onActivity: () => {}, onCitation: () => {}, onTurn,
    responseCheck: text => text === "checked answer" ? undefined : "缺少指定的依据",
  }, signal());
  expect(commands.filter(command => command.args.includes("--print"))).toHaveLength(2);
  expect(commands.filter(command => command.args.includes("--print"))[1]!.input).toContain("缺少指定的依据");
  expect(Boolean(result.blocked)).toBe(!fixed);
  expect(onTurn.mock.calls.at(-1)?.[0]).toBe(fixed ? "checked answer" : "本轮回答仍未通过检查，已停止自动重试。请查看回答检查提示，补充依据或调整要求后重试。");
});
it.each([{ auth: "api_key" }, { old: true }, { tools: true }, { truncated: true }, { failExit: true }])("fails closed for unsupported login, permissions, tool events or incomplete processes: %j", async options => {
  const { executor } = fixture(options);
  await expect(executeAgent(executor, { prompt: "合成问题" }, signal())).rejects.toThrow();
});
it("blocks live native execution before probing when offline, and rejects Codex without the required isolation flags", async () => {
  const runner = vi.fn<NativeRunner>(async (_command, _signal, line) => { line(flags); });
  const offline = new NativeAgentExecutor("claude", { ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, runner);
  await expect(executeAgent(offline, { prompt: "合成" }, signal())).rejects.toThrow("live_provider_disabled"); expect(runner).not.toHaveBeenCalled();
  const codex = new NativeAgentExecutor("codex", {}, runner);
  expect(await codex.status(signal())).toMatchObject({ installed: true, available: false });
  await expect(codex.execute({ messages: [{ role: "user", content: "合成" }], maxOutputChars: 100 }, signal())).rejects.toThrow("native_isolation_unavailable");
});
it("never routes an AgentExecutor through ordinary ModelClient or silent fallback", () => {
  const registry = new ProviderRegistry(); const { executor } = fixture();
  registry.registerAgent("native-claude", executor); registry.route("tutor", "native-claude");
  expect(registry.backend("native-claude")).toBe(executor);
  expect(() => new ProviderRuntime(registry, new MockModelClient()).forInvocation("tutor")).toThrow("native_agent_task_required");
});
it("uses the same persisted AgentService for desktop and CLI-facing invocations; unpinned native teams fail explicitly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-service-")); const { executor, commands } = fixture();
  const store = new AgentSessionStore(root); const service = new AgentService(store, () => executor);
  try {
    expect(DesktopService).toBe(AgentService);
    const session = await service.create();
    await service.invoke({ sessionId: session.id, text: "第一次合成问题", provider: "native-claude", style: "adaptive" });
    await service.pauseMaintenance();
    await service.invoke({ sessionId: session.id, text: "第二次合成问题", provider: "native-claude", style: "adaptive" });
    const answer = (await store.load(session.id)).messages.at(-1)!;
    expect(answer).toMatchObject({ status: "completed", timings: { turns: 0, toolCalls: 0, nativeExecution: { provider: "native-claude", verification: "unverified" } } });
    expect(commands.filter(command => command.args.includes("--print")).at(-1)!.input).toContain("第一次合成问题");
    await service.send({ sessionId: session.id, text: "组成团队", provider: "native-claude", style: "adaptive", collaboration: teamConfigurationSchema.parse({ mode: "same-model-team" }) }); await service.idle();
    const failed = (await store.load(session.id)).messages.at(-1)!;
    expect(failed.status).toBe("failed"); expect(failed.error).toContain("固定具体模型");
  } finally { await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
it("terminates an actual stalled process on cancellation and drops unrelated environment overrides", async () => {
  const controller = new AbortController(); let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  const pending = runNativeProcess({ executable: process.execPath, args: ["-e", 'console.log("ready");setInterval(()=>{},1000)'], input: "", cwd: os.tmpdir(), environment: nativeEnvironment(process.env) }, controller.signal, () => ready());
  await started; controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(nativeEnvironment({ OPENAI_API_KEY: "fixture", NODE_OPTIONS: "--require=fixture", HTTPS_PROXY: "http://localhost:15236", PATH: "/bin" })).toEqual({ HTTPS_PROXY: "http://localhost:15236", PATH: "/bin" });
});

it("runs native routing through the actual CLI and retains its full shared conversation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cli-"));
  try {
    const preload = path.join(root, "fixture.mjs"), calls = path.join(root, "calls.json");
    await fs.writeFile(preload, `import fs from 'node:fs/promises';
import { NativeAgentExecutor } from ${JSON.stringify(new URL("../src/native-agent.ts", import.meta.url).href)};
globalThis.fetch = async () => { throw new Error('unexpected_network'); };
NativeAgentExecutor.prototype.prepare = async function() { if(this.vendor==='codex') throw new Error('native_isolation_unavailable'); };
NativeAgentExecutor.prototype.execute = async function(request, signal, onText) {
 let calls=[];try {calls=JSON.parse(await fs.readFile(${JSON.stringify(calls)},'utf8'));}catch{}
 calls.push(request.messages);await fs.writeFile(${JSON.stringify(calls)},JSON.stringify(calls));
 const text='来自官方执行器夹具的教学回答。';onText?.(text);return {status:'completed',verification:'unverified',text};
};`);
    const options = { cwd: process.cwd(), timeout: 15_000, env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0", NO_COLOR: "1" } };
    const args = ["--import", "tsx", "--import", preload, "src/cli.ts"];
    const run = promisify(execFile);
    expect((await run(process.execPath, [...args, "模型切换 tutor native-claude --确认"], options)).stdout).toContain("tutor -> native-claude");
    expect((await run(process.execPath, [...args, "请解释单元测试"], options)).stdout).toContain("来自官方执行器夹具");
    expect((await run(process.execPath, [...args, "请继续举例"], options)).stdout).toContain("来自官方执行器夹具");
    const history = JSON.parse(await fs.readFile(calls, "utf8"));
    expect(JSON.stringify(history.at(-1))).toContain("请解释单元测试");
    expect(JSON.stringify(history.at(-1))).toContain("来自官方执行器夹具");
    expect((await run(process.execPath, [...args, "模型切换 tutor codex-cli --确认"], options)).stdout).toContain("tutor -> codex-cli");
    await expect(run(process.execPath, [...args, "验证旧别名的执行边界"], options)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("隔离要求") });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
