import { ExplanationReview } from "./explanation-review.js";
import { useEffect, useState } from "react";
import type { OutcomeProtocol, OutcomeMode, OutcomePhase, OutcomeSubmission, OutcomeSummary, OutcomeView } from "../../src/outcome-contracts.js";
import type { ChatSession, DesktopCommand } from "../core/contracts.js";

async function request<T>(command: DesktopCommand): Promise<T> { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data as T; }
const phases = { pre: "学前检查", lesson: "学习对话", post: "学后检查", waiting: "等待复习", delayed: "延迟复习", complete: "已完成", abandoned: "已结束，保留记录" };
const modeName = (mode: OutcomeMode) => mode === "zhixing" ? "知行引导教学" : "同模型直接聊天";
interface Snapshot { trials: OutcomeView[]; report: OutcomeSummary; }

export function OutcomePanel({ topicId, disabled, onLesson }: { topicId: string; disabled: boolean; onLesson: (session: ChatSession) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [mode, setMode] = useState<OutcomeMode>("zhixing");
  const [protocol, setProtocol] = useState<OutcomeProtocol>("full_product");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function refresh() { setSnapshot(await request<Snapshot>({ type: "outcome-list", topicId })); }
  useEffect(() => { let mounted = true; void request<Snapshot>({ type: "outcome-list", topicId }).then(value => { if (mounted) setSnapshot(value); }).catch(problem => { if (mounted) setError(problem.message); }); return () => { mounted = false; }; }, [topicId]);
  async function action(command: DesktopCommand) {
    setBusy(true); setError("");
    try {
      const result = await request<unknown>(command);
      if (command.type === "outcome-lesson") onLesson(result as ChatSession);
      else await refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "操作未完成"); }
    finally { setBusy(false); }
  }
  const active = snapshot?.trials.find(t => !["complete", "abandoned"].includes(t.stage));
  const locked = disabled || busy;
  return <section className="assessment-panel outcome-panel" aria-label="学习效果验证">
    <h3>学习效果验证</h3>
    <p>先独立作答，再学习，最后用不同情境检查理解；3 天后再看看记住了多少。选择题由程序评分，文字解释保留待人工复核，结果不改变课程完成状态。</p>
    {!active && <div className="outcome-actions"><label>验证范围<select aria-label="验证范围" value={protocol} disabled={locked} onChange={event => setProtocol(event.target.value as OutcomeProtocol)}><option value="full_product">完整产品能力</option><option value="prompt_only">仅提示方式</option></select></label><label>学习方式<select aria-label="验证学习方式" value={mode} disabled={locked} onChange={event => setMode(event.target.value as OutcomeMode)}><option value="zhixing">知行引导教学</option><option value="direct">同模型直接聊天</option></select></label><button disabled={locked || !snapshot || !["agent-development", "rag"].includes(topicId)} onClick={() => void action({ type: "outcome-start", topicId, mode, protocol })}>开始学习验证</button></div>}
    {!active && !["agent-development", "rag"].includes(topicId) && <p>当前检查覆盖 Agent 执行边界和 RAG 证据判断，其他主题尚未配置。</p>}
    {active && <div className="outcome-active">
      <strong>{active.protocol === "full_product" ? "完整产品" : "提示方式"} · {active.title} · {modeName(active.mode)} · {phases[active.stage]}</strong>
      {active.repeated && <p>你已参与过这个主题，本次作为重复练习保留，不计入首次独立作答对照。</p>}
      {active.questions.length > 0 && <OutcomeForm key={`${active.id}-${active.stage}`} trial={active} disabled={locked} submit={submission => action({ type: "outcome-submit", topicId, id: active.id, phase: active.stage as OutcomePhase, submission })} />}
      {active.stage === "lesson" && <><p>学习对话使用设置中当前选定的模型，正常支持追问和停止。{active.protocol === "full_product" ? "完整产品组使用知行实际教学与工具流程，学习资料、项目和外部工具仍需在对话中逐项授权；直接聊天组不接入这些能力。" : "本次仅比较引导教学提示与直接聊天提示。"}检查题和你的检查作答不会自动发送给模型。</p><div className="outcome-actions"><button disabled={locked} onClick={() => void action({ type: "outcome-lesson", topicId, id: active.id })}>{active.sessionId ? "继续本次学习对话" : "进入本次学习对话"}</button><button disabled={locked || !active.sessionId} onClick={() => void action({ type: "outcome-finish-lesson", topicId, id: active.id })}>结束学习，开始学后检查</button></div></>}
      {active.stage === "waiting" && <><p>复习时间：{new Date(active.reviewAt!).toLocaleString()}。到期后请先独立作答，再查看解析。</p><button disabled={locked || Date.parse(active.reviewAt!) > Date.now()} onClick={() => void action({ type: "outcome-retention", topicId, id: active.id })}>开始延迟复习</button><button disabled={locked} onClick={() => void refresh().catch(problem => setError(problem.message))}>刷新复习时间</button></>}
      <details><summary>暂不继续这次验证</summary><p>结束后保留已有结果，下次参与标记为重复练习。</p><button disabled={locked} onClick={() => void action({ type: "outcome-abandon", topicId, id: active.id })}>结束验证并保留记录</button></details>
    </div>}
    {snapshot && snapshot.trials.length > 0 && <>
      <h4>本地记录 · {snapshot.report.total} 次</h4>
      <p>以下为个人描述性记录：学习方式由你选择，题卷难度尚未校准，不能据此认定因果效果或已掌握。演示、模型信息缺失或变化、借助帮助、重复参与不进入首次独立对照。</p>
      <details><summary>查看记录分布与复核情况</summary>
        <p>尚未完成的验证：{snapshot.report.incomplete} 次。文字解释待复核 {snapshot.report.calibration.reviews.pending} 份，单人复核 {snapshot.report.calibration.reviews.singleReviewed} 份，多人复核 {snapshot.report.calibration.reviews.doubleReviewed} 份，其中意见不一致 {snapshot.report.calibration.reviews.disagreements} 份。评阅者身份由填写者提供。</p>
        {snapshot.report.groups.map(group => <p key={`${group.label}-${group.mode}-distribution`}>{modeName(group.mode)}：学后变化范围 {group.scoreDistribution.min?.toFixed(1)} 至 {group.scoreDistribution.max?.toFixed(1)} 个百分点；{group.scoreDistribution.standardDeviation === null ? "只有一份记录，无法计算记录间的标准差" : `标准差 ${group.scoreDistribution.standardDeviation.toFixed(1)} 个百分点（描述记录间差异）`}；缺少可计入的独立延迟结果 {group.missingRetention} 次。</p>)}
        <p>{snapshot.report.calibration.interpretation}</p>
        {snapshot.report.calibration.forms.map(form => <p key={JSON.stringify([form.topicId, form.formId, form.phase, form.mode, form.conditions])}>题卷 {form.formId + 1} · {phases[form.phase as OutcomePhase]} · {modeName(form.mode as OutcomeMode)}：{form.records} 份，平均得分 {form.meanScore?.toFixed(1)}%。不同条件分别计数。</p>)}
      </details>
      {snapshot.report.groups.length ? <div className="outcome-table"><table><thead><tr><th>相同条件</th><th>学前→学后</th><th>学前→延迟</th></tr></thead><tbody>{snapshot.report.groups.map(group => <tr key={`${group.label}-${group.mode}`}><td>{modeName(group.mode)}<small>{group.label}</small></td><td>{group.independentPairs} 次 · {group.scoreChange?.toFixed(1)} 个百分点</td><td>{group.retentionPairs ? `${group.retentionPairs} 次 · ${group.retentionChange?.toFixed(1)} 个百分点` : "尚无独立延迟结果"}</td></tr>)}</tbody></table></div> : <p>尚无可计入首次独立对照的完整学前／学后记录。</p>}
      {snapshot.trials.map(trial => <details key={trial.id} className="outcome-record"><summary>{new Date(trial.createdAt).toLocaleDateString()} · {modeName(trial.mode)} · {phases[trial.stage]}</summary>{(["pre", "post", "delayed"] as const).map(phase => { const result = trial.results[phase]; return result && <div key={phase}><strong>{phases[phase]}：{result.correctCount}/{result.total} · {({ independent: "自报独立作答", hint: "使用提示或资料", solution: "看过答案或借助 AI" })[result.assistance]}</strong><p className="outcome-explanation">你的解释：{result.explanation}</p><small>{result.explanationReview === "human_reviewed" ? "文字解释已记录人工复核" : result.explanationReview === "withdrawn" ? "文字解释评分已撤回" : "文字解释待人工复核"} · 从打开到提交经过 {Math.round(result.elapsedMs / 1000)} 秒（包含离开界面的时间）</small>{["complete", "abandoned"].includes(trial.stage) && <ExplanationReview result={result} disabled={locked} submit={review => action({ type: "outcome-review-explanation", topicId, id: trial.id, phase, review })} />}</div>; })}{trial.provenance && <p>构建版本：{trial.provenance.codeHash.slice(0, 12)} · {trial.protocol === "full_product" ? "完整产品" : "提示方式"}</p>}{trial.lesson && <p>学习中完成 {trial.lesson.completedTurns} 轮回答，未完成 {trial.lesson.failedTurns} 轮。</p>}{trial.feedback?.map(text => <p key={text}>复习解析：{text}</p>)}</details>)}
      <button disabled={locked} onClick={() => void action({ type: "outcome-export", topicId })}>导出验证记录（含作答）</button>
    </>}
    {error && <p className="message-error" role="alert">{error}</p>}
  </section>;
}

function OutcomeForm({ trial, disabled, submit }: { trial: OutcomeView; disabled: boolean; submit: (submission: OutcomeSubmission) => Promise<void> }) {
  const [answers, setAnswers] = useState([-2, -2, -2]); const [explanation, setExplanation] = useState("");
  const [assistance, setAssistance] = useState<OutcomeSubmission["assistance"] | "">("");
  return <form onSubmit={event => { event.preventDefault(); if (assistance) void submit({ answers, explanation, assistance }); }}>
    {trial.questions.map((question, index) => <fieldset key={index} disabled={disabled}><legend>{index + 1}. {question.title}</legend>{[...question.choices, "暂时不会"].map((choice, position) => { const value = position === 3 ? -1 : position; return <label key={choice}><input type="radio" name={`outcome-${index}`} checked={answers[index] === value} onChange={() => setAnswers(answers.map((answer, i) => i === index ? value : answer))} />{choice}</label>; })}</fieldset>)}
    <label>用自己的话说明判断依据，并举一个不同的例子<textarea aria-label="学习验证解释" maxLength={2000} disabled={disabled} value={explanation} onChange={event => setExplanation(event.target.value)} /></label>
    <label>本次作答方式<select aria-label="检查作答方式" disabled={disabled} value={assistance} onChange={event => setAssistance(event.target.value as typeof assistance)}><option value="">请选择实际情况</option><option value="independent">未查看提示、资料或答案，独立作答</option><option value="hint">使用了提示或资料</option><option value="solution">看过答案或借助 AI 作答</option></select></label>
    <button className="primary" disabled={disabled || answers.includes(-2) || !explanation.trim() || !assistance}>保存{phases[trial.stage]}</button>
  </form>;
}
