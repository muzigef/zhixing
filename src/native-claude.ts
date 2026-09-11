import path from "node:path";
import type { AgentExecutionResult } from "./agent-executor.js";
import type { NativeRuntimeAdapter } from "./native-runtime-contract.js";
import { record, array, string } from "./provider-http.js";

export const claudeRuntimeAdapter: NativeRuntimeAdapter = {
  environment: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  model: () => "official-runtime-selected",
  async probe(_command, _runner, _signal, help) {
    const available = ["--restricted", "--safe-mode", "--tools", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "--system-prompt-file"].every(flag => help.includes(flag));
    return { available, reason: available ? "可执行仅上下文任务；登录状态由官方 Claude Code 检查。" : "需要支持 --restricted 与 --safe-mode 的新版 Claude Code。" };
  },
  async execute(command, runner, request, _model, signal, onText) {
    let streamed = "", final: AgentExecutionResult | undefined;
    const systemFile = path.join(command.cwd, "instructions.txt");
    // Require the user's own subscription login. No API-key fallback or token import.
    let subscription = false;
    try {
      let authOutput = "";
      await runner({ executable: command.executable, args: ["auth", "status", "--json"], input: "", cwd: command.cwd, environment: command.environment }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), line => {
        authOutput += line + "\n"; if (authOutput.length > 16_000) throw new Error("provider_protocol_error");
      });
      const state = record(JSON.parse(authOutput)); subscription = state.loggedIn === true && state.authMethod === "claude.ai";
    } catch { signal.throwIfAborted(); throw new Error("native_subscription_required"); }
    if (!subscription) throw new Error("native_subscription_required");
    const args = ["--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--safe-mode", "--restricted", "--system-prompt-file", systemFile, "--tools", "", "--disallowedTools", "*", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--no-session-persistence", "--no-chrome", "--disable-slash-commands", "--effort", request.reasoning === "deep" ? "high" : request.reasoning === "quick" ? "low" : "medium"];
    await runner({ executable: command.executable, args, cwd: command.cwd, environment: command.environment, input: JSON.stringify(request.messages.filter(message => message.role !== "system")) + "\n" }, signal, line => {
      let value: unknown; try { value = JSON.parse(line); } catch { throw new Error("provider_protocol_error"); }
      const event = record(value);
      if (event.type === "stream_event") {
        const part = record(event.event);
        if (part.type === "content_block_start" && record(part.content_block).type === "tool_use") throw new Error("native_tool_denied");
        if (part.type === "content_block_delta") {
          const delta = record(part.delta);
          if (delta.type === "text_delta") { const text = string(delta.text, request.maxOutputChars); streamed += text; if (streamed.length > request.maxOutputChars) throw new Error("provider_output_limit"); onText?.(text); }
        }
      } else if (event.type === "assistant" && array(record(event.message).content).some(block => record(block).type === "tool_use")) throw new Error("native_tool_denied");
      else if (event.type === "result") {
        if (final || event.subtype !== "success" || event.is_error === true) throw new Error("provider_protocol_error");
        const text = string(event.result, request.maxOutputChars);
        if (streamed && streamed !== text) throw new Error("provider_protocol_error");
        const usage = event.usage ? record(event.usage) : undefined;
        const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
        final = { status: "completed", verification: "unverified", text, ...(valid(event.num_turns) ? { runtimeTurns: event.num_turns } : {}) };
        if (usage && valid(usage.input_tokens) && valid(usage.output_tokens)) final.usage = { inputTokens: usage.input_tokens + (valid(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0) + (valid(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0), outputTokens: usage.output_tokens };
      }
    });
    if (!final || !final.text.trim()) throw new Error("provider_incomplete");
    if (!streamed) onText?.(final.text);
    return final;
  },
};
