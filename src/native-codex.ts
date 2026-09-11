import path from "node:path";
import type { AgentExecutionResult, AgentExecutor } from "./agent-executor.js";
import type { NativeCommand, NativeRunner, NativeRuntimeAdapter } from "./native-runtime-contract.js";
import { record, string } from "./provider-http.js";

/** Values are passed as literal argv, never interpreted by a shell. */
function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function codexModel(environment: NodeJS.ProcessEnv): string {
  const model = environment.ZHIXING_CODEX_MODEL?.trim() || "gpt-6-astra";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model) || model === "auto") throw new Error("native_model_required");
  return model;
}

/** Official permission profiles deny reads outside the platform minimum and this disposable directory.
 * The runtime may access its own authentication internally; no agent tool is exposed to the model. */
export function codexArguments(directory: string, model: string, reasoning?: string): string[] {
  const disabled = ["shell_tool", "unified_exec", "apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external", "computer_use", "in_app_browser", "view_image", "image_generation", "memories", "multi_agent", "skill_search", "workspace_dependencies", "sleep_tool", "tool_suggest", "code_mode", "code_mode_host"];
  const config = {
    default_permissions: "zhixing_context",
    permissions: { zhixing_context: { filesystem: { ":minimal": "read", [directory]: "read" }, network: { enabled: false } } },
    approval_policy: "never", forced_login_method: "chatgpt", model_provider: "openai",
    web_search: "disabled", project_doc_max_bytes: 0,
    model_instructions_file: path.join(directory, "instructions.txt"), model,
    model_reasoning_effort: reasoning === "deep" ? "high" : reasoning === "quick" ? "low" : "medium",
    mcp_servers: {}, features: { ...Object.fromEntries(disabled.map(feature => [feature, false])), skip_host_skill_discovery: true },
  };
  return ["exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--skip-git-repo-check", "--json", "--color", "never", "--cd", directory,
    ...Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`]), "-"];
}

export async function executeCodex(command: Omit<NativeCommand, "args" | "input">, runner: NativeRunner, request: Parameters<AgentExecutor["execute"]>[0], model: string, signal: AbortSignal, onText?: (text: string) => void): Promise<AgentExecutionResult> {
  let subscription = false;
  try {
    await runner({ ...command, args: ["login", "status"], input: "", subscriptionStatus: true }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), line => {
      // Never expose the original line: API-key login status can contain a key prefix.
      if (/^Logged in using ChatGPT\s*$/i.test(line.trim())) subscription = true;
    });
  } catch { signal.throwIfAborted(); throw new Error("native_subscription_required"); }
  if (!subscription) throw new Error("native_subscription_required");
  let started = false, completed = false, text = "";
  let usage: AgentExecutionResult["usage"];
  await runner({ ...command, args: codexArguments(command.cwd, model, request.reasoning), input: JSON.stringify(request.messages.filter(message => message.role !== "system")) + "\n" }, signal, line => {
    let parsed: unknown; try { parsed = JSON.parse(line); } catch { throw new Error("provider_protocol_error"); }
    const event = record(parsed);
    if (event.type === "turn.started") {
      if (started || completed) throw new Error("provider_protocol_error"); started = true;
    } else if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
      const item = record(event.item);
      if (!["agent_message", "reasoning", "error"].includes(String(item.type))) throw new Error("native_tool_denied");
      if (item.type === "agent_message" && event.type === "item.completed") {
        if (!started || completed) throw new Error("provider_protocol_error");
        const part = string(item.text, request.maxOutputChars);
        text += part; if (text.length > request.maxOutputChars) throw new Error("provider_output_limit");
        onText?.(part);
      }
    } else if (event.type === "turn.completed") {
      if (!started || completed) throw new Error("provider_protocol_error"); completed = true;
      if (event.usage) {
        const value = record(event.usage);
        if (![value.input_tokens, value.output_tokens].every(item => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) throw new Error("provider_protocol_error");
        // cached_input_tokens is a subset of input_tokens, not an additional charge.
        usage = { inputTokens: value.input_tokens as number, outputTokens: value.output_tokens as number };
      }
    } else if (event.type === "turn.failed" || event.type === "error") throw new Error("provider_protocol_error");
    else if (event.type !== "thread.started") throw new Error("provider_protocol_error");
  });
  if (!completed || !text.trim()) throw new Error("provider_incomplete");
  return { text, usage, runtimeTurns: 1, status: "completed", verification: "unverified" };
}


export const codexRuntimeAdapter: NativeRuntimeAdapter = {
  model: codexModel,
  async probe(command, runner, signal) {
    let execHelp = "", sandboxHelp = "", version = "", available = false;
    try {
      await runner({ ...command, args: ["--version"], input: "" }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), line => { version += line; });
      for (const name of ["exec", "sandbox"]) await runner({ ...command, args: [name, "--help"], input: "" }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), line => { if (name === "exec") execHelp += line + "\n"; else sandboxHelp += line + "\n"; });
      // Enable only releases whose wire request and permission profile passed acceptance.
      available = /^codex-cli 0\.153\.4$/.test(version.trim()) && ["--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--json"].every(flag => execHelp.includes(flag)) && /--permission-profile/.test(sandboxHelp);
    } catch { signal.throwIfAborted(); }
    return { available, reason: available ? "可通过官方 Codex 的 ChatGPT 订阅执行仅上下文任务；不依赖 Pi。" : "当前仅验收 Codex 0.153.4 的隔离权限与空工具请求；其他版本需先验收后启用。" };
  },
  execute: executeCodex,
};
