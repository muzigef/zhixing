import { useState } from "react";
import type { LearningObservation } from "../../src/learning-observations.js";
export const assistanceLabels = { independent: "自报独立作答", hint: "使用提示或资料", solution: "看过答案或借助 AI", unknown: "未记录帮助方式" };
export function ObservationPanel({ records, disabled, refresh }: { records: LearningObservation[]; disabled: boolean; refresh: () => Promise<void> }) {
  return <section className="assessment-panel" aria-label="可追溯学习记录"><h3>可追溯学习记录</h3><p>来自你实际提交的知识检查，用于后续学习建议，不表示整体掌握。撤回后不再加入新的学习背景，已有作答和历史对话保留。</p>{records.length ? records.map(record => <Observation key={`${record.id}-${record.revision}`} record={record} disabled={disabled} refresh={refresh} />) : <p>提交知识检查后，这里会显示来源和帮助方式。</p>}</section>;
}
function Observation({ record, disabled, refresh }: { record: LearningObservation; disabled: boolean; refresh: () => Promise<void> }) {
  const [annotation, setAnnotation] = useState(record.annotation); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(withdrawn: boolean) {
    setBusy(true); setError("");
    try { const result = await window.zhixing.invoke({ type: "observation-update", topicId: record.topicId, id: record.id, revision: record.revision, annotation, withdrawn }); if (!result.ok) throw new Error(result.error); await refresh(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "保存未完成"); } finally { setBusy(false); }
  }
  return <details className="learning-observation" data-revision={record.revision}><summary>{record.source.dayId} · {assistanceLabels[record.assistance]} · {record.withdrawn ? "已撤回" : "用于后续建议"}</summary><p>来源：知识检查 {record.id} · {new Date(record.submittedAt).toLocaleString()} · 选择题 {record.correctCount}/{record.total}</p><p>原始复盘：{record.original || "未填写"}</p><label>补充或更正<textarea aria-label="学习记录更正" maxLength={2000} value={annotation} onChange={event => setAnnotation(event.target.value)} disabled={disabled || busy} /></label><button disabled={disabled || busy} onClick={() => void save(record.withdrawn)}>保存更正</button><button disabled={disabled || busy} onClick={() => void save(!record.withdrawn)}>{record.withdrawn ? "恢复用于建议" : "撤回学习记录"}</button>{record.changes.length > 0 && <details><summary>修改记录 · {record.changes.length}</summary>{record.changes.map(change => <p key={change.revision}>版本 {change.revision} · {change.withdrawn ? "撤回" : "有效"} · {change.annotation || "未补充说明"}</p>)}</details>}{error && <p role="alert">{error}</p>}</details>;
}
