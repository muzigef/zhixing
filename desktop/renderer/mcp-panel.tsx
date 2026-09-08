import { useEffect, useState } from "react";
import type { McpConfiguration, McpServer } from "../../src/mcp-settings.js";
import type { DesktopCommand } from "../core/contracts.js";
async function request<T>(command: DesktopCommand): Promise<T> { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data as T; }

export function McpPanel({ topicId, disabled }: { topicId: string; disabled: boolean }) {
  const [value, setValue] = useState<McpConfiguration>(); const [draft, setDraft] = useState("[]");
  const [trusted, setTrusted] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [status, setStatus] = useState("");
  const accept = (next: McpConfiguration) => { setValue(next); setDraft(JSON.stringify(next.servers, null, 2)); };
  useEffect(() => { let current = true; void request<McpConfiguration>({ type: "mcp-settings", topicId }).then(next => { if (current) accept(next); }).catch(() => { if (current) setError("无法读取连接配置。"); }); return () => { current = false; }; }, [topicId]);
  async function save(servers: McpServer[]) {
    if (!value) return; setBusy(true); setError("");
    try { accept(await request<McpConfiguration>({ type: "mcp-save", topicId, revision: value.revision, servers })); setStatus("当前主题的连接配置已保存。"); setTrusted(false); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "配置未保存。"); } finally { setBusy(false); }
  }
  return <details className="learning-section mcp-panel"><summary>外部工具 · MCP</summary>
    <p>仅连接你信任的本机服务。默认 trusted 模式以你的账户权限运行，可能访问文件和网络；工具标记 read 只是声明，不能限制进程。macOS 可选 restricted 模式：禁止网络，只能读取明确列出的路径和运行所需系统文件，写入限于临时目录。其他平台暂不支持受限模式，连接会被拒绝。</p>
    <p>启用后，当前主题已授权对话可向服务发送工具参数。更改隔离模式或读取路径会使旧授权失效；知行不向服务提供模型账户凭据。</p>
    <p>支持 stdio 文本工具。不要填写密钥或认证文件路径；当前不支持 HTTP、自动登录、图像或服务器发起的模型调用。</p>
    <label>当前主题连接配置（JSON）<textarea aria-label="MCP 连接配置" rows={12} value={draft} disabled={disabled || busy || !value} onChange={event => setDraft(event.target.value)} /></label>
    <details><summary>受限服务模板（macOS）</summary><pre>{JSON.stringify({ id: "restricted-notes", enabled: false, consent: "local-process-and-topic-inputs", command: "/absolute/path/to/node", args: ["/absolute/path/to/server.mjs"], isolation: "restricted", readPaths: ["/absolute/path/to/server.mjs"], tools: [{ name: "search", risk: "read", replaySafe: false }] }, null, 2)}</pre><p>按实际需要逐项填写读取路径；目录授权包括目录内文件。不要授权整个个人目录。需要网络的服务与此模式不兼容。</p></details>
    <details><summary>配置示例与权限说明</summary><pre>{JSON.stringify([{ id: "local-notes", command: "/absolute/path/to/node", args: ["/absolute/path/to/server.mjs"], enabled: false, consent: "local-process-and-topic-inputs", tools: [{ name: "search", risk: "read", replaySafe: true }] }], null, 2)}</pre><p>command 必须为绝对路径，args 为独立参数。tools 只列允许调用的名称；read 表示查询，write 需要操作授权。仅确认没有副作用的查询才设 replaySafe 为 true。服务器的只读提示不会自动改变这些权限。</p></details>
    <label><input type="checkbox" checked={trusted} disabled={disabled || busy} onChange={event => setTrusted(event.target.checked)} />我信任所填服务，并允许当前主题向其发送工具参数</label>
    <details><summary>写入中断后的结果核对</summary><p>服务若提供只读状态查询，可以在写工具配置中添加 reconcile。查询工具也必须列入 tools，标记 read 和 replaySafe: true。核对会检查操作标识和明确的状态；无法核对时保留未知结果。</p><pre>{JSON.stringify({ reconcile: { tool: "operation_status", argument: "operationId", identity: "operationId", resultIdentity: "operationId", status: "status", succeeded: "succeeded", notExecuted: "not_found" } }, null, 2)}</pre><p>字段映射到服务的输入与 structuredContent 顶层字段。只有服务保证 not_found 表示从未执行时，才将它配置为 notExecuted。</p></details>
    <button disabled={disabled || busy || !value || !trusted} onClick={() => { try { const parsed = JSON.parse(draft); if (!Array.isArray(parsed)) throw new Error(); void save(parsed); } catch { setError("配置需要是有效的 JSON 数组。"); } }}>保存 MCP 配置</button>
    {value?.servers.map(server => <div key={server.id} className="workspace-row"><span>{server.id} · {server.enabled ? "已启用" : "已停用"} · {server.isolation === "restricted" ? "系统沙箱受限" : "本机账户权限"} · {server.tools.length} 个工具</span>
      <button disabled={disabled || busy} onClick={async () => { setBusy(true); setError(""); try { const result = await request<{ tools: string[] }>({ type: "mcp-test", topicId, serverId: server.id }); setStatus(`${server.id} 连接成功，可用工具：${result.tools.join("、") || "无"}。测试未调用业务工具。`); } catch (problem) { setError(problem instanceof Error ? problem.message : "连接未完成。"); } finally { setBusy(false); } }}>测试 {server.id} 连接</button>
      {server.enabled && <button disabled={disabled || busy} onClick={() => void save(value.servers.map(item => item.id === server.id ? { ...item, enabled: false } : item))}>停用 {server.id}</button>}
    </div>)}
    {busy && <p role="status">正在检查连接… <button onClick={() => void request({ type: "learning-cancel" })}>取消连接检查</button></p>}
    {error && <p role="alert" className="message-error">{error}</p>}{status && <p role="status">{status}</p>}
  </details>;
}
