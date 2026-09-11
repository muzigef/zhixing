import { useEffect, useState } from "react";
import { Plus, Check, Settings2 } from "lucide-react";
import { apiConnectionInputSchema, isCustomProvider, type ApiConnection, type ApiConnectionInput } from "../../src/api-connection-config.js";
import { providerCatalog, providerTemplate } from "../../src/provider-catalog.js";
import type { BootState, DesktopCommand, DesktopSettings } from "../core/contracts.js";

async function request<T>(command: DesktopCommand): Promise<T> {
  const value = await window.zhixing.invoke(command);
  if (!value.ok) throw new Error(value.error);
  return value.data as T;
}
const empty = (): ApiConnectionInput => apiConnectionInputSchema.parse({ name: "新模型", baseUrl: "https://api.example.com/v1", model: "model-id" });
export function ApiConnectionsPanel({ profiles, settings, busy, onSave, onUpdated, onBusy }: {
  profiles?: BootState["apiConnections"]; settings: DesktopSettings; busy: boolean;
  onSave: (settings: DesktopSettings) => Promise<void>; onUpdated: (state: BootState) => void; onBusy: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<ApiConnectionInput>(empty);
  const [preset, setPreset] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState(false);
  const connections = profiles?.connections ?? [];
  const selected = connections.find(item => item.id === settings.provider);
  const original = connections.find(item => item.id === editing);
  useEffect(() => { setApiKey(""); setError(""); setNotice(""); setEditing(undefined); setRemoving(false); }, [settings.provider]);
  function edit(connection?: ApiConnection) {
    setPreset("");
    setApiKey(""); setError(""); setNotice(""); setRemoving(false);
    setEditing(connection?.id ?? "new");
    if (connection) setDraft(apiConnectionInputSchema.parse(Object.fromEntries(Object.keys(apiConnectionInputSchema.shape).map(key => [key, connection[key as keyof ApiConnection]]))));
    else setDraft(empty());
  }
  async function act(action: () => Promise<void>) {
    setWorking(true); onBusy(true); setError(""); setNotice("");
    try { await action(); } catch (problem) { setError(problem instanceof Error ? problem.message : "连接操作未完成，请重试。"); }
    finally { setWorking(false); onBusy(false); }
  }
  async function save() {
    const checked = apiConnectionInputSchema.safeParse(draft);
    if (!checked.success) { setError("请检查名称、API 根地址、模型 ID 和上下文预算。地址需使用 HTTPS（本机可用 HTTP），不要填写 /chat/completions、/messages、/responses 或查询参数。"); return; }
    await act(async () => {
      const state = await request<BootState>({ type: "api-connection-save", revision: profiles?.revision ?? 0, connection: checked.data, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setApiKey(""); onUpdated(state); setEditing(undefined); setNotice("连接已保存。选择它后即可开始对话。");
    });
  }
  return <div className="custom-connections">
    <div className="connection-heading"><h3>自定义 API 连接</h3><button type="button" disabled={busy || working || connections.length >= 20} onClick={() => edit()}><Plus size={14} />添加 API 连接</button></div>
    <p className="connection-help">支持 10 家服务商模板及自定义连接。同一家可添加多个模型，各连接的 Key 独立加密保存。API 与订阅套餐的权益由服务商分别管理。</p>
    <div className="provider-options">
      {connections.map(connection => <div className="custom-connection-row" key={connection.id}>
        <button type="button" className={`provider-option ${settings.provider === connection.id ? "chosen" : ""}`} disabled={working} onClick={() => void act(() => onSave({ ...settings, provider: connection.id }))}>
          <span><strong>{connection.name}</strong><small>{connection.model} · {connection.configured ? "已保存 Key" : "待配置 Key"}</small></span>{settings.provider === connection.id && <Check size={17} />}
        </button>
        <button type="button" className="connection-edit" aria-label={`管理 ${connection.name}`} disabled={busy || working} onClick={() => edit(connection)}><Settings2 size={16} /></button>
      </div>)}
    </div>
    {isCustomProvider(settings.provider) && !selected && <p role="alert" className="message-error">当前连接已移除，请选择其他模型后再发送。已有对话会保留。</p>}
    {selected && !editing && <div className="connection-selected"><p>{selected.baseUrl}</p><button type="button" className="api-connection-button" disabled={busy || working || !selected.configured} onClick={() => void act(async () => {
      const result = await request<{ firstTokenMs: number; durationMs: number }>({ type: "check-api", provider: selected.id });
      setNotice(`连接正常 · 首字 ${(result.firstTokenMs / 1000).toFixed(2)} 秒 · 总耗时 ${(result.durationMs / 1000).toFixed(2)} 秒`);
    })}>{working ? "正在测试…" : "测试自定义连接"}</button><small>发送一条固定测试消息，不携带对话或学习资料。测试可能产生少量 API 用量。</small></div>}
    {editing && <form className="connection-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h4>{original ? "管理连接" : "添加 API 连接"}</h4>
      {!original && <><label>服务商模板<select aria-label="服务商模板" value={preset} onChange={event => { const id = event.target.value; setPreset(id); setDraft(id ? providerTemplate(id) : empty()); setApiKey(""); }}><option value="">自定义服务商</option>{providerCatalog.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        {preset && <p className="connection-help">{providerCatalog.find(provider => provider.id === preset)?.accountNote} 模型 ID 请从服务商控制台复制。</p>}
      </>}
      <label>连接名称<input aria-label="连接名称" value={draft.name} maxLength={60} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
      <label>接口协议<select aria-label="接口协议" disabled={!!original} value={draft.protocol} onChange={event => setDraft({ ...draft, protocol: event.target.value as ApiConnectionInput["protocol"], reasoning: "none" })}><option value="openai-chat-completions">Chat Completions（OpenAI 兼容）</option><option value="openai-responses">Responses（OpenAI）</option><option value="anthropic-messages">Messages（Anthropic 兼容）</option></select></label>
      <label>API 根地址<input aria-label="API 根地址" value={draft.baseUrl} maxLength={2048} placeholder="https://api.example.com/v1" readOnly={!!original} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} required /></label>
      <label>模型 ID<input aria-label="模型 ID" value={draft.model} maxLength={128} readOnly={!!original} onChange={event => setDraft({ ...draft, model: event.target.value })} required /></label>
      <label>API Key<input type="password" aria-label="自定义 API Key" autoComplete="off" spellCheck={false} value={apiKey} maxLength={4096} placeholder={original?.configured ? "留空保留已保存的 Key" : "粘贴该服务的 API Key"} onChange={event => setApiKey(event.target.value)} required={!original?.configured} /></label>
      {original ? <p className="connection-help">可修改名称或替换 Key。更换地址、模型或兼容参数，请添加新连接，以保留旧任务的模型身份。</p> : <details className="connection-advanced"><summary>能力与兼容选项</summary>
        <label><input type="checkbox" checked={draft.tools} onChange={event => setDraft({ ...draft, tools: event.target.checked })} />支持工具调用</label>
        <label><input type="checkbox" checked={draft.images} onChange={event => setDraft({ ...draft, images: event.target.checked })} />支持图片</label>
        {draft.protocol === "openai-chat-completions" && <label><input type="checkbox" checked={draft.streamUsage} onChange={event => setDraft({ ...draft, streamUsage: event.target.checked })} />请求流式 Token 用量（不兼容时关闭）</label>}
        {draft.protocol !== "anthropic-messages" && <label>思考参数<select aria-label="思考参数" value={draft.reasoning} onChange={event => setDraft({ ...draft, reasoning: event.target.value as ApiConnectionInput["reasoning"] })}><option value="none">不额外发送（默认）</option><option value="openai">{draft.protocol === "openai-responses" ? "OpenAI reasoning.effort" : "OpenAI reasoning_effort"}</option>{draft.protocol === "openai-chat-completions" && <><option value="deepseek">DeepSeek thinking</option><option value="kimi">Kimi reasoning_effort</option></>}</select></label>}
        {draft.protocol === "openai-chat-completions" && <label>输出上限参数<select aria-label="输出上限参数" value={draft.tokenField} onChange={event => setDraft({ ...draft, tokenField: event.target.value as ApiConnectionInput["tokenField"] })}><option value="max_tokens">max_tokens（默认）</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>}
        <label>上下文窗口<input type="number" aria-label="连接上下文窗口" min={2048} max={48000} value={draft.contextWindow} onChange={event => setDraft({ ...draft, contextWindow: Number(event.target.value) })} /></label>
        <label>模型输出上限<input type="number" aria-label="模型输出上限" min={128} max={16384} value={draft.maxOutputTokens} onChange={event => setDraft({ ...draft, maxOutputTokens: Number(event.target.value) })} /></label>
        <p>按模型文档填写能力；模板不代表所有模型支持图片或工具。Messages 使用 max_tokens；Responses 使用 max_output_tokens，均不发送 Chat Completions 的兼容参数。Messages 根地址需含 /v1，例如 https://api.anthropic.com/v1。</p>
      </details>}
      <div className="connection-actions"><button type="submit" disabled={busy || working}>{working ? "处理中…" : "保存连接"}</button><button type="button" disabled={working} onClick={() => { setEditing(undefined); setApiKey(""); setRemoving(false); }}>取消</button>{original && <button type="button" disabled={busy || working} onClick={() => setRemoving(true)}>移除连接</button>}</div>
      {removing && original && <div className="connection-remove"><p>从模型列表移除“{original.name}”？对话和系统加密的 Key 文件会保留；待执行的旧任务不会自动改用其他模型。</p><button type="button" disabled={busy || working} onClick={() => void act(async () => {
        onUpdated(await request<BootState>({ type: "api-connection-remove", revision: profiles?.revision ?? 0, id: original.id })); setEditing(undefined); setRemoving(false); setApiKey(""); setNotice("连接已移除。");
      })}>确认移除连接</button></div>}
    </form>}
    {error && <p role="alert" className="message-error">{error}</p>}
    {notice && <p role="status" className="api-key-success">{notice}</p>}
  </div>;
}
