import fs from "node:fs/promises";
import { expect, it } from "vitest";
import { NativeAgentExecutor, type NativeCommand, type NativeRunner } from "../src/native-agent.js";

function fixture(options: { auth?: string; tool?: boolean; truncated?: boolean; failed?: boolean; model?: string; output?: string; version?: string } = {}) {
  const calls: NativeCommand[] = [];
  const runner: NativeRunner = async (command, _signal, line) => {
    calls.push(command);
    if (command.args[0] === "--version") { line(options.version ?? "codex-cli 0.153.4"); return; }
    if (command.args.includes("--help")) { line("--ignore-user-config --ignore-rules --strict-config --ephemeral --json --permission-profile"); return; }
    if (command.args[0] === "login") { line(options.auth ?? "Logged in using ChatGPT"); return; }
    if (command.args[0] !== "exec") throw new Error("unexpected_native_command");
    expect(await fs.readFile(command.args.find(value => value.startsWith("model_instructions_file="))!.split("=").slice(1).join("=").replace(/^"|"$/g, ""), "utf8")).toContain("教学规则");
    line(JSON.stringify({ type: "thread.started", thread_id: "synthetic-thread" }));
    line(JSON.stringify({ type: "turn.started" }));
    line(JSON.stringify({ type: "item.completed", item: { type: options.tool ? "command_execution" : "agent_message", text: options.output ?? "合成答案" } }));
    if (!options.truncated) line(JSON.stringify({ type: options.failed ? "turn.failed" : "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 4 } }));
  };
  return { calls, executor: new NativeAgentExecutor("codex", { ZHIXING_CODEX_MODEL: options.model ?? "gpt-6-astra", OPENAI_API_KEY: "synthetic-not-inherited" }, runner, "/synthetic/codex") };
}
const request = { messages: [{ role: "system" as const, content: "教学规则" }, { role: "assistant" as const, content: "历史回答" }, { role: "user" as const, content: "当前问题" }], maxOutputChars: 1000 };
it("executes an explicitly pinned official ChatGPT subscription with no Pi, tools, user config or persisted session", async () => {
  const { executor, calls } = fixture(); const output: string[] = [];
  const result = await executor.execute(request, new AbortController().signal, text => output.push(text));
  expect(result).toMatchObject({ text: "合成答案", runtimeTurns: 1, usage: { inputTokens: 100, outputTokens: 4 }, verification: "unverified" });
  expect(output.join("")).toBe(result.text);
  expect(executor.identity.model).toBe("gpt-6-astra");
  const command = calls.find(call => call.args[0] === "exec" && !call.args.includes("--help"))!;
  expect(command.args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", 'forced_login_method="chatgpt"', 'model_provider="openai"', 'web_search="disabled"']));
  expect(command.args.join(" ")).toContain('"shell_tool"=false');
  expect(command.args.join(" ")).toContain('"network"={"enabled"=false}');
  expect(command.args).not.toContain("--sandbox");
  expect(command.environment).not.toHaveProperty("OPENAI_API_KEY");
  expect(command.input).toContain('"role":"assistant"');
  await expect(fs.stat(command.cwd)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each([{ auth: "Logged in using an API key: synthetic" }, { tool: true }, { truncated: true }, { failed: true }, { output: "x".repeat(1001) }])("rejects unsupported auth, native tools, failed/incomplete turns and output overflow: %j", async options => {
  const { executor } = fixture(options);
  await expect(executor.execute(request, new AbortController().signal)).rejects.toThrow();
});
it("refuses unverified runtime releases before authentication or dispatch", async () => {
  const { executor, calls } = fixture({ version: "codex-cli 0.999.0" });
  await expect(executor.execute(request, new AbortController().signal)).rejects.toThrow("native_isolation_unavailable");
  expect(calls.some(call => call.args[0] === "login" || call.args[0] === "exec" && !call.args.includes("--help"))).toBe(false);
});
