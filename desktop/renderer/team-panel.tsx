import { nativeRuntimeCatalog } from "../../src/native-runtime-catalog.js";
import { useState } from "react";
import { teamTaskRetryProblem } from "../../src/team-work-contracts.js";
import { teamTaskStatusLabels, teamVerificationLabels } from "../../src/team-contracts.js";
import { collaborationLabels, memberRoleLabels, memberStatusLabels, teamConfigurationSchema, teamStatusLabels, type TeamConfiguration, type TeamSnapshot } from "../../src/team-contracts.js";
import type { BootState, DesktopSettings } from "../core/contracts.js";
import { providerLabel } from "../../src/api-connection-config.js";
import { teamFailureLabels, type TeamReport } from "../../src/team-quality.js";

function Report({ report }: { report: TeamReport }) {
  return <div><p>{report.summary}</p>{report.claims.map(claim => <p key={claim.key}><strong>{claim.key}：{claim.value}</strong><br />{claim.basis}</p>)}{report.uncertainties.length > 0 && <p>仍有不确定性：{report.uncertainties.join("；")}</p>}</div>;
}

export function TeamCard({ team, running, onStop, onRerun, onRetryTask, canRerun }: { team: TeamSnapshot; running: boolean; onStop: (id: string) => void; onRerun: () => void; onRetryTask: (id: string) => void; canRerun: boolean }) {
  return <details className="team-card"><summary>{collaborationLabels[team.mode]} · {teamStatusLabels[team.status]}</summary>
    <p>{team.members.filter(member => member.status === "completed").length} / {team.members.length} 成员已完成 · 主模型 {team.lead.model}</p>
    {team.members.map((member, index) => <section key={member.id}><div className="team-member-heading"><strong>{memberRoleLabels[member.role]}</strong><span>{memberStatusLabels[member.status]}</span>{running && (["queued", "running"].includes(member.status) || team.review?.followUp?.member === index + 1 && team.review.followUp.status === "running") && <button onClick={() => onStop(member.id)}>停止此成员</button>}</div>
      <p className="message-meta">{providerLabel(member.binding.provider)} · {member.binding.model}{member.durationMs !== undefined ? ` · ${(member.durationMs / 1000).toFixed(1)} 秒` : ""}</p>
      {member.resourcePolicy && <p className="message-meta">本次采用：{({ quick: "快速", balanced: "均衡", deep: "深入" } as const)[member.binding.reasoning]} · 每次至多 {member.resourcePolicy.maxOutputTokens} token（推理与正文合计） · {({ explicit: "手动指定档位", inherited: "继承主 Agent 档位", "budget-aware": "按可用输出预算自动匹配" } as const)[member.resourcePolicy.reasoningSource]}{member.resourcePolicy.budgetLimited ? "。当前预算低于该档位的建议目标，仍可能截断；可调整成员或整题输出预算。" : ""}</p>}
      <p>{member.task}</p>{member.error && <p role="status">{member.error}</p>}
      {member.report ? <details><summary>查看成员结论与依据</summary><Report report={member.report} /></details> : member.result && <details><summary>查看成员结论</summary><pre className="team-result">{member.result}</pre></details>}
    </section>)}
    {team.review && <section aria-label="团队分歧审查"><strong>分歧审查 · {({ pending: "等待核查", running: "核查中", completed: "已返回审查意见", failed: "未完成", skipped: "未执行", interrupted: "已中断" } as const)[team.review.status]}</strong>
      {team.review.guidance && <p>{team.review.guidance}</p>}{team.review.issues?.map(issue => <p key={issue}>{issue}</p>)}
      {team.review.failureCode && <p>{teamFailureLabels[team.review.failureCode]}</p>}
      {team.review.followUp && <details><summary>查看定向复核 · {({ pending: "等待核查", running: "核查中", completed: "已返回结果", failed: "未完成", skipped: "未执行", interrupted: "已中断" } as const)[team.review.followUp.status]}</summary><p>{team.review.followUp.question}</p>{team.review.followUp.report && <Report report={team.review.followUp.report} />}{team.review.followUp.failureCode && <p>{teamFailureLabels[team.review.followUp.failureCode]}</p>}</details>}
    </section>}
    {!!team.tasks?.length && <section className="team-tasks"><strong>任务与依赖</strong>{team.tasks.map(task => <details key={task.id}>
      <summary>{task.goal} · {teamTaskStatusLabels[task.status]}</summary>
      <p>成员 {task.member} · {task.attempts} 次执行{task.dependsOn.length ? ` · 前置任务：${task.dependsOn.join("、")}` : " · 可独立执行"}</p>
      <ul>{task.acceptance.map((item, index) => <li key={index}>{item}</li>)}</ul>
      {task.report && <Report report={task.report} />}
      {!!task.evidence?.length && <p>已记录 {task.evidence.length} 条实际工具回执；回执不自动证明推论正确。</p>}
      {!teamTaskRetryProblem(team.tasks, task.id) && <button disabled={!canRerun || running} onClick={() => onRetryTask(task.id)}>补做此任务</button>}
    </details>)}</section>}
    {team.verification && <section className="team-verification"><strong>{teamVerificationLabels[team.verification.status]}</strong><p>交付条件覆盖 {team.verification.covered} / {team.verification.total} · 关联工具依据 {team.verification.linked} 项</p><ul>{team.verification.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p className="message-meta">这是核查覆盖记录，不是正确性认证。最终回答仍需结合具体依据判断。</p></section>}
    {!!(team.review?.recheck?.checks ?? team.review?.checks)?.length && <details><summary>逐项核查依据</summary><ul>{(team.review?.recheck?.checks ?? team.review?.checks)?.map((check, index) => <li key={index}>{check.task} / 条件 {check.criterion + 1}：{check.status === "supported" ? "已审查" : "待核查"} · {check.reason}{check.sourceTask ? ` · 依据任务 ${check.sourceTask}` : ""}</li>)}</ul></details>}
    {team.review?.recheck && <p>补证后审查：{team.review.recheck.guidance ?? (team.review.recheck.failureCode ? teamFailureLabels[team.review.recheck.failureCode] : "等待完成")}</p>}
    <p className="message-meta">共 {team.modelTurns} 次模型请求{team.nativeTasks ? ` · ${team.nativeTasks} 次官方 Agent 任务` : ""} · {team.toolCalls} 次工具请求 · 已报告输入 {team.inputTokens} / 输出 {team.outputTokens} token{team.unknownUsageRequests ? ` · ${team.unknownUsageRequests} 次用量未知` : ""}</p>
    {team.nativeTokenLimit && <p className="message-meta">官方 Agent 按任务数、时限和回答长度限制；token 用量在返回后核算，可能超过输出目标。无法确认的用量保留预留，不记为零。</p>}
    <p className="message-meta">成员结论供主 Agent 核查；完成状态不代表回答正确性已获认证。{team.planning === "fallback" ? "主模型分工未取得有效结构，已使用固定核查职责。" : ""}</p>
    {["partial", "failed", "interrupted"].includes(team.status) && <><p className="message-meta">继续会复用已保存结论。补做只重试所选任务及尚未执行的依赖分支，再重新审查和综合；保留原预算，可能再次计费。用量未知的旧请求仍计入预留。重新运行会创建新任务。</p><button disabled={!canRerun} onClick={onRerun}>重新运行整个团队（新任务）</button></>}
  </details>;
}
export function TeamSettingsPanel({ settings, boot, onSave }: { settings: DesktopSettings; boot?: BootState; onSave: (value: TeamConfiguration) => Promise<void> }) {
  const [config, setConfig] = useState(teamConfigurationSchema.parse(settings.collaboration ?? {})); const [saving, setSaving] = useState(false);
  const providers = [...nativeRuntimeCatalog.filter(entry => entry.teams).map(entry => entry.provider), "pi-codex", "deepseek-api", "kimi-api", "demo", ...(boot?.apiConnections?.connections.map(item => item.id) ?? [])] as const;
  return <form className="team-settings" onSubmit={event => { event.preventDefault(); setSaving(true); void onSave(teamConfigurationSchema.parse(config)).finally(() => setSaving(false)); }}>
    <p>{collaborationLabels[config.mode]}。团队仍为实验功能；复杂问题可能受益，也可能更慢或引入错误。</p>
    <p>主 Agent 按交付条件和依赖分配任务；成员可持续使用自己的工作记录。审查发现问题时追加一次定向复核并重新审查，然后综合回答。成员只读，最多两名，不递归。</p>
    <p className="message-meta">自动模式结合模型能力、成员与整题输出预算选择档位。推理与正文共用额度的模型按快速 4096、均衡 8192、深入 16384 token 的建议目标匹配，预算不足时使用较低档位；手动档位优先，旧任务保留原配置。快速档的实际行为因模型而异。</p>
    {config.members.map((member, index) => <fieldset key={index}><legend>成员 {index + 1}</legend>
      <label>核查职责<select aria-label={`成员 ${index + 1} 职责`} value={member.role} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, role: event.target.value as typeof member.role } : item) })}>{Object.entries(memberRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
      <label>思考程度<select aria-label={`成员 ${index + 1} 思考程度`} value={member.reasoning ?? "inherit"} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, reasoning: event.target.value === "inherit" ? undefined : event.target.value as "quick" | "balanced" | "deep" } : item) })}><option value="inherit">按预算自动匹配</option><option value="quick">快速</option><option value="balanced">均衡</option><option value="deep">深入</option></select></label>
      <label>每次输出预算<select aria-label={`成员 ${index + 1} 输出上限`} value={member.maxOutputTokens ?? "auto"} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, maxOutputTokens: event.target.value === "auto" ? undefined : Number(event.target.value) } : item) })}><option value="auto">自动分配</option>{[1024, 2048, 4096, 8192, 16384].map(value => <option key={value} value={value}>{value} token</option>)}</select></label>
      {config.mode === "mixed-model-team" ? <label>模型连接<select aria-label={`成员 ${index + 1} 模型连接`} value={member.provider ?? ""} onChange={event => setConfig({ ...config, members: config.members.map((item, i) => i === index ? { ...item, provider: event.target.value as typeof member.provider } : item) })}><option value="" disabled>选择连接</option>{providers.map(provider => <option key={provider} value={provider}>{providerLabel(provider, boot?.apiConnections?.connections)}</option>)}</select></label> : <p>跟随主 Agent 的实际模型：{providerLabel(settings.provider, boot?.apiConnections?.connections)}</p>}
    </fieldset>)}
    <label className="team-consent"><input type="checkbox" checked={config.shareContext} onChange={event => setConfig({ ...config, shareContext: event.target.checked })} />允许团队成员使用本会话历史及已授权的资料、项目和外部查询</label>
    <p className="message-meta">关闭时成员只收到当前问题及本次图片；开启也不会授予写入或超出本会话原有权限。异模型模式会把这些内容发给所选服务商。</p>
    <label>最多同时执行的成员<select aria-label="团队并发成员数" value={config.maxConcurrency} onChange={event => setConfig({ ...config, maxConcurrency: Number(event.target.value) })}><option value={1}>1</option><option value={2}>2</option></select></label>
    <label>单成员时限<select aria-label="团队成员时限" value={config.memberTimeoutMs} onChange={event => setConfig({ ...config, memberTimeoutMs: Number(event.target.value) })}>{[60_000, 90_000, 120_000, 150_000, 180_000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></label>
    <label>整题时限<select aria-label="团队整题时限" value={config.timeoutMs} onChange={event => setConfig({ ...config, timeoutMs: Number(event.target.value) })}>{[180_000, 240_000, 300_000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></label>
    <label>整题输出预算<select aria-label="团队整题输出预算" value={config.maxOutputTokens} onChange={event => setConfig({ ...config, maxOutputTokens: Number(event.target.value) })}>{[...new Set([config.maxOutputTokens, 16384, 24576, 32768, 48000])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} token</option>)}</select></label>
    <p className="message-meta">自动分配先为分工、审查和最终回答留出额度，再计算每名成员的单次上限。较高预算允许更多推理，也可能增加耗时和费用；建议目标不保证一定足够。</p>
    <p className="message-meta">每题最多 {config.maxModelTurns} 次调用（API 请求与官方 Agent 任务合计），{config.timeoutMs / 1000} 秒，输出预算 {config.maxOutputTokens} token。API 按服务商支持的上限执行；官方 Agent 仅能限制回答长度，token 在返回后核算，可能超出目标，超出后不再发起调用。未知用量保留预留。Pi 同一订阅连接暂串行调用。</p>
    <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存团队配置"}</button>
  </form>;
}
