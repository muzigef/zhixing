import { useEffect, useState } from "react";
import type { TaskInspection, RecoveryReport } from "../../src/task-continuity.js";
import type { DesktopCommand } from "../core/contracts.js";

export function TaskPanel({ sessionId, taskId, active, onContinue, onReported }: { sessionId: string; taskId: string; active: boolean; onContinue: () => void; onReported: () => void }) {
  const [info, setInfo] = useState<TaskInspection>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState(""); const [note, setNote] = useState(""); const [outcome, setOutcome] = useState<RecoveryReport["outcome"]>("abandoned");
  const identity = { sessionId, taskId };
  async function request<T>(command: DesktopCommand): Promise<T> { const response = await window.zhixing.invoke(command); if (!response.ok) throw new Error(response.error); return response.data as T; }
  useEffect(() => { let current = true; void request<TaskInspection>({ type: "task-info", sessionId, taskId }).then(value => { if (current) { setInfo(value); setGoal(value.task?.goal ?? ""); } }).catch(problem => { if (current) setError(problem.message); }); return () => { current = false; }; }, [sessionId, taskId, active]);
  async function perform(command: DesktopCommand) {
    setBusy(true); setError("");
    try { await request(command); if (command.type === "task-report") onReported(); setInfo(await request({ type: "task-info", ...identity })); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "任务操作未完成"); }
    finally { setBusy(false); }
  }
  const disabled = busy || active;
  const stopLabel = info ? ({ completed: "本段已完成", cancelled: "用户已停止", waiting: "等待回复或授权", task_incomplete: "计划尚未完成", blocked: "任务受阻", max_turns: "已达到本段模型轮次上限", invocation_timeout: "已达到本段时间上限", repeated_tool_call: "检测到重复工具请求" } as Record<string, string>)[info.usage.lastStopReason] ?? "本段未完成，具体原因见对话提示" : "";
  return <div className="task-panel">
    {error && <p role="alert">{error}</p>}
    {!info ? <p>正在读取任务记录…</p> : <>
      <p>{info.task?.goal ?? "这段对话尚未建立执行计划。"}</p>
      <p role="status">{stopLabel}</p>
      {!!info.task?.plan.length && <ol>{info.task.plan.map(step => <li key={step.id}>{step.completed ? "✓" : "○"} {step.title}</li>)}</ol>}
      {info.recovery && <section aria-label="外部操作核对">
        <h3>上一项外部操作的结果尚未确认</h3>
        <p>可以使用服务的只读核对规则，或者记录你在服务中看到的情况。用户自报会单独标注。</p>
        <button disabled={disabled} onClick={() => void perform({ type: "task-verify", ...identity, callId: info.recovery!.callId })}>通过服务核对结果</button>
        <label>我的核对结果<select aria-label="我的核对结果" value={outcome} disabled={disabled} onChange={event => setOutcome(event.target.value as RecoveryReport["outcome"])}><option value="abandoned">结束这项操作，结果仍不确定</option><option value="reported_success">我看到了执行成功的结果</option><option value="reported_not_executed">我确认没有执行</option></select></label>
        <label>核对说明<textarea aria-label="核对说明" maxLength={2000} value={note} disabled={disabled} onChange={event => setNote(event.target.value)} /></label>
        <button disabled={disabled || !note.trim()} onClick={() => void perform({ type: "task-report", ...identity, callId: info.recovery!.callId, report: { outcome, note } })}>记录我的观察</button>
      </section>}
      {!!info.receipts.length && <details><summary>外部操作核对记录</summary>{info.receipts.map(receipt => { const value = receipt.result as { verified: boolean; outcome: string; note?: string }; return <p key={receipt.callId}>{value.verified ? "服务已核对" : "用户自报，尚未由服务核验"} · {({ succeeded: "已执行", not_executed: "未执行", reported_success: "报告已执行", reported_not_executed: "报告未执行", abandoned: "已结束该项操作" } as Record<string, string>)[value.outcome] ?? "结果待确认"}{value.note ? `：${value.note}` : ""}</p>; })}</details>}
      <label>修订任务目标<textarea aria-label="修订任务目标" maxLength={4000} disabled={disabled || !!info.recovery} value={goal} onChange={event => setGoal(event.target.value)} /></label>
      <p>明确改变目标时使用。旧计划会保留，已发生的操作不会被撤销。</p>
      <button disabled={disabled || !!info.recovery || !goal.trim() || goal === info.task?.goal} onClick={() => void perform({ type: "task-revise", ...identity, revision: info.task?.revision ?? 0, goal })}>保存新目标并继续</button>
      <button disabled={disabled || !!info.recovery} onClick={onContinue}>按当前目标继续</button>
      {!!info.revisions.length && <details><summary>目标修订记录 · {info.revisions.length}</summary>{info.revisions.map(revision => <div key={revision.revision}><p>第 {revision.revision} 次调整前：{revision.goal}</p><ul>{revision.plan.map(step => <li key={step.id}>{step.title}</li>)}</ul><p>调整后：{revision.replacementGoal}</p></div>)}</details>}
      <details><summary>任务累计用量</summary><p>{info.usage.segments} 个执行段，{info.usage.modelTurns} 轮模型请求，{info.usage.toolCalls} 次工具请求，累计耗时 {(info.usage.elapsedMs / 1000).toFixed(1)} 秒。</p><p>Provider 已报告输入 {info.usage.inputTokens}、输出 {info.usage.outputTokens} Token；未报告的用量不计入。每个执行段仍受原有预算限制。</p></details>
    </>}
  </div>;
}
