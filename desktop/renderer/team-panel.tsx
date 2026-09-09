import { useState } from "react";
import { collaborationLabels, memberRoleLabels, memberStatusLabels, teamConfigurationSchema, teamStatusLabels, type TeamConfiguration, type TeamSnapshot } from "../../src/team-contracts.js";
import type { BootState, DesktopSettings } from "../core/contracts.js";
import { providerLabel } from "../../src/api-connection-config.js";

export function TeamCard({ team, running, onStop, onRerun, canRerun }: { team: TeamSnapshot; running: boolean; onStop: (id: string) => void; onRerun: () => void; canRerun: boolean }) {
  return <details className="team-card"><summary>{collaborationLabels[team.mode]} · {teamStatusLabels[team.status]}</summary>
    <p>{team.members.filter(member => member.status === "completed").length} / {team.members.length} 成员已完成 · 主模型 {team.lead.model}</p>
    {team.members.map(member => <section key={member.id}><div className="team-member-heading"><strong>{memberRoleLabels[member.role]}</strong><span>{memberStatusLabels[member.status]}</span>{running && ["queued", "running"].includes(member.status) && <button onClick={() => onStop(member.id)}>停止此成员</button>}</div>
      <p className="message-meta">{providerLabel(member.binding.provider)} · {member.binding.model}{member.durationMs !== undefined ? ` · ${(member.durationMs / 1000).toFixed(1)} 秒` : ""}</p>
      <p>{member.task}</p>{member.error && <p role="status">{member.error}</p>}
      {member.result && <details><summary>查看成员结论</summary><pre className="team-result">{member.result}</pre></details>}
    </section>)}
    <p className="message-meta">共 {team.modelTurns} 次模型请求 · {team.toolCalls} 次工具请求 · 已报告输入 {team.inputTokens} / 输出 {team.outputTokens} token{team.unknownUsageRequests ? ` · ${team.unknownUsageRequests} 次用量未知` : ""}</p>
    <p className="message-meta">成员结论供主 Agent 核查；完成状态不代表回答正确性已获认证。{team.planning === "fallback" ? "主模型分工未取得有效结构，已使用固定核查职责。" : ""}</p>
    {["partial", "failed", "interrupted"].includes(team.status) && <><p className="message-meta">继续会复用已保存结论。重新运行会创建新任务，并再次请求全部成员。</p><button disabled={!canRerun} onClick={onRerun}>重新运行整个团队（新任务）</button></>}
  </details>;
}
export function TeamSettingsPanel({ settings, boot, onSave }: { settings: DesktopSettings; boot?: BootState; onSave: (value: TeamConfiguration) => Promise<void> }) {
  const [config, setConfig] = useState(teamConfigurationSchema.parse(settings.collaboration ?? {})); const [saving, setSaving] = useState(false);
  const providers = ["pi-codex", "deepseek-api", "kimi-api", "demo", ...(boot?.apiConnections?.connections.map(item => item.id) ?? [])] as const;
  return <form className="team-settings" onSubmit={event => { event.preventDefault(); setSaving(true); void onSave(teamConfigurationSchema.parse(config)).finally(() => setSaving(false)); }}>
    <p>{collaborationLabels[config.mode]}。团队仍为实验功能；复杂问题可能受益，也可能更慢或引入错误。</p>
    <p>主 Agent 分配核查目标，成员独立分析后由主 Agent 综合；成员只读，最多两名，不递归。</p>
    {config.members.map((member, index) => <fieldset key={index}><legend>成员 {index + 1}</legend>
      <label>核查职责<select aria-label={`成员 ${index + 1} 职责`} value={member.role} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, role: event.target.value as typeof member.role } : item) })}>{Object.entries(memberRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
      {config.mode === "mixed-model-team" ? <label>模型连接<select aria-label={`成员 ${index + 1} 模型连接`} value={member.provider ?? ""} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, provider: event.target.value as typeof member.provider } : item) })}><option value="" disabled>选择连接</option>{providers.map(provider => <option key={provider} value={provider}>{providerLabel(provider, boot?.apiConnections?.connections)}</option>)}</select></label> : <p>跟随主 Agent 的实际模型：{providerLabel(settings.provider, boot?.apiConnections?.connections)}</p>}
    </fieldset>)}
    <label className="team-consent"><input type="checkbox" checked={config.shareContext} onChange={event => setConfig({ ...config, shareContext: event.target.checked })} />允许团队成员使用本会话历史及已授权的资料、项目和外部查询</label>
    <p className="message-meta">关闭时成员只收到当前问题及本次图片；开启也不会授予写入或超出本会话原有权限。异模型模式会把这些内容发给所选服务商。</p>
    <label>最多同时执行的成员<select aria-label="团队并发成员数" value={config.maxConcurrency} onChange={event => setConfig({ ...config, maxConcurrency: Number(event.target.value) })}><option value={1}>1</option><option value={2}>2</option></select></label>
    <label>单成员时限<select aria-label="团队成员时限" value={config.memberTimeoutMs} onChange={event => setConfig({ ...config, memberTimeoutMs: Number(event.target.value) })}>{[60_000, 90_000, 120_000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></label>
    <label>整题时限<select aria-label="团队整题时限" value={config.timeoutMs} onChange={event => setConfig({ ...config, timeoutMs: Number(event.target.value) })}>{[180_000, 240_000, 300_000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></label>
    <p className="message-meta">Pi 同一订阅连接暂串行调用。每题共享上限：{config.maxModelTurns} 次模型请求、{config.maxOutputTokens} 输出 token、{config.timeoutMs / 1000} 秒；未知用量按预留上限计算。</p>
    <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存团队配置"}</button>
  </form>;
}
