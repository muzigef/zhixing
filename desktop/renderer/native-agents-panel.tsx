import { useState } from "react";
import type { NativeAgentStatus } from "../../src/native-agent.js";
import type { DesktopSettings } from "../core/contracts.js";
import { providerLabel } from "../../src/api-connection-config.js";

export function NativeAgentsPanel({ settings, busy, onSave }: { settings: DesktopSettings; busy: boolean; onSave: (settings: DesktopSettings) => Promise<void> }) {
  const [statuses, setStatuses] = useState<NativeAgentStatus[]>([]), [error, setError] = useState(""), [checking, setChecking] = useState(false);
  const [executable, setExecutable] = useState(settings.nativeClaudeExecutable ?? "claude");
  const [codexExecutable, setCodexExecutable] = useState(settings.nativeCodexExecutable ?? "");
  const [codexModel, setCodexModel] = useState(settings.nativeCodexModel ?? "gpt-6-astra");
  return <div className="custom-connections">
    <h3>官方 Agent 账号</h3>
    <p className="connection-help">账号登录由官方客户端管理，知行不保存订阅凭证。Codex 可直接使用 ChatGPT 订阅，支持单 Agent 和团队；请先运行 codex login。原生通道依据已提供的上下文回答，不执行本机工具。Claude Code 暂支持单 Agent；其他官方运行时保留扩展接口，按需要接入。</p>
    <details><summary>Codex 程序与模型</summary>
      <label>可执行文件<input aria-label="Codex 可执行文件" value={codexExecutable} placeholder="自动查找 codex" maxLength={2048} onChange={event => setCodexExecutable(event.target.value)} /></label>
      <label>模型<input aria-label="Codex 订阅模型" value={codexModel} maxLength={128} onChange={event => setCodexModel(event.target.value)} /></label>
      <button type="button" disabled={busy || checking || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(codexModel) || codexModel === "auto"} onClick={() => { setError(""); setChecking(true); void onSave({ ...settings, nativeCodexExecutable: codexExecutable.trim() || undefined, nativeCodexModel: codexModel }).then(() => setStatuses([])).catch(() => setError("Codex 配置未保存，请重试。")).finally(() => setChecking(false)); }}>保存 Codex 配置</button>
      <p>填写订阅支持的具体模型。团队会固定此模型，避免成员在运行时自动换用其他模型。程序位置可留空，macOS 会同时查找常用 Homebrew 安装位置。</p>
    </details>
    <details><summary>Claude Code 程序位置</summary><label>可执行文件<input aria-label="Claude Code 可执行文件" value={executable} maxLength={2048} onChange={event => setExecutable(event.target.value)} /></label><button type="button" disabled={busy || checking || !executable.trim()} onClick={() => { setError(""); setChecking(true); void onSave({ ...settings, nativeClaudeExecutable: executable.trim() }).then(() => setStatuses([])).catch(() => setError("程序位置未保存，请重试。")).finally(() => setChecking(false)); }}>保存程序位置</button><p>可填写官方程序的绝对路径；默认从 PATH 查找 claude。先在该客户端完成订阅登录。</p></details>
    <button type="button" disabled={busy || checking} onClick={() => {
      setChecking(true); setError("");
      void window.zhixing.invoke({ type: "native-agent-status" }).then(result => { if (!result.ok) throw new Error(result.error); setStatuses(result.data as NativeAgentStatus[]); }).catch(() => setError("检查未完成，请确认官方程序可以启动。")).finally(() => setChecking(false));
    }}>{checking ? "正在检查…" : "检查官方 Agent"}</button>
    <small>只检查本机程序能力；不读取账号文件，也不发送模型请求。</small>
    {statuses.map(status => <div className="connection-selected" key={status.vendor}><strong>{providerLabel(`native-${status.vendor}`)}</strong><p>{status.reason}</p>{status.available && <button type="button" disabled={busy || checking} onClick={() => { setError(""); void onSave({ ...settings, provider: `native-${status.vendor}`, collaboration: undefined }).catch(() => setError("切换未完成，请重试。")); }}>以单 Agent 使用</button>}</div>)}
    {error && <p role="alert" className="message-error">{error}</p>}
  </div>;
}
