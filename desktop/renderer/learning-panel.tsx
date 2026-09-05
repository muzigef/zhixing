import { useEffect, useState } from "react";
import type { LearningOverview, WorkspaceSummary } from "../../src/learning-contracts.js";
import type { BootState, DesktopCommand } from "../core/contracts.js";
import { SkillPanel } from "./skill-panel.js";
import { EvidencePanel } from "./evidence-panel.js";
import { AssessmentPanel } from "./assessment-panel.js";

async function request<T>(command: DesktopCommand): Promise<T> {
  const result = await window.zhixing.invoke(command);
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}

export function LearningPanel({ workspace, topicId, busy: taskBusy, onWorkspace, onDiscuss }: {
  workspace: WorkspaceSummary;
  topicId: string;
  busy: boolean;
  onWorkspace: (state: BootState) => void;
  onDiscuss: (text: string) => void;
}) {
  const [overview, setOverview] = useState<LearningOverview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function refresh() { setOverview(await request<LearningOverview>({ type: "learning-overview", topicId })); }
  useEffect(() => {
    let mounted = true; setOverview(undefined); setError("");
    if (topicId) void request<LearningOverview>({ type: "learning-overview", topicId }).then((value) => { if (mounted) setOverview(value); }).catch((problem) => { if (mounted) setError(String(problem.message)); });
    return () => { mounted = false; };
  }, [topicId, workspace.id]);
  async function action(command: string) {
    setBusy(true); setError("");
    try {
      const value = await request<{ text: string; overview: LearningOverview }>({ type: "learning-action", topicId, command });
      setOverview(value.overview); setResult(value.text);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "学习操作未完成"); }
    finally { setBusy(false); }
  }
  async function importFile() {
    setBusy(true); setError("");
    try {
      const value = await request<{ cancelled?: boolean; status?: string; chunks?: number; reason?: string }>({ type: "learning-import", topicId });
      if (!value.cancelled) {
        const labels: Record<string, string> = { indexed: "已导入并建立索引", duplicate: "这份资料已经导入", ocr_low_confidence: "已导入，部分扫描文字需要核对", ocr_required: "需要安装本地 OCR 才能识别这份扫描资料", parse_failed: "无法解析这份资料", rejected: "资料导入未完成" };
        setResult(`${labels[value.status ?? ""] ?? "导入未完成"}${value.chunks ? `，共 ${value.chunks} 个片段。` : "。"}`);
        await refresh();
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : "导入未完成"); }
    finally { setBusy(false); }
  }
  return <div className="learning-panel">
    <p className="modal-description">课程、资料与学习进度保存在工作区中，可以与 CLI 共用。</p>
    <div className="workspace-row"><span title={workspace.path}>{workspace.path}</span><button disabled={busy || taskBusy} onClick={() => {
      setBusy(true);
      void request<BootState>({ type: "workspace-select" }).then(onWorkspace).catch((problem) => setError(problem.message)).finally(() => setBusy(false));
    }}>连接现有工作区</button></div>
    {!topicId && <p>请先在顶部选择一个学习主题。</p>}
    {error && <p className="message-error" role="alert">{error}</p>}
    {overview && <>
      <div className="learning-section-heading"><h3>{overview.title}</h3><button onClick={() => void refresh().catch((problem) => setError(problem.message))}>刷新进度</button></div>
      <p className="learning-next">{overview.next}</p>
      <div className="course-list">{overview.course.map((day) => {
        const state = overview.days.find((item) => item.dayId === day.id)?.state ?? "未开始";
        return <div key={day.id} className="course-row"><div><strong>{day.id} · {day.title}</strong><small>{day.estimatedMinutes} 分钟 · {state}{day.optional ? " · 可选" : ""}</small></div>
          <button disabled={busy || taskBusy} onClick={() => void action(`开始第 ${Number(day.id.slice(1))} 天`)}>{state === "未开始" ? "开始学习" : "查看学习卡"}</button></div>;
      })}</div>
      {!overview.course.length && <p>这个主题还没有可展示的课程。可以通过 CLI 创建或完善课程。</p>}
      <SkillPanel key={`skills-${topicId}`} topicId={topicId} disabled={busy || taskBusy} onDiscuss={onDiscuss} />
      <EvidencePanel key={topicId} topicId={topicId} days={overview.days} disabled={busy || taskBusy} onReview={refresh} />
      <AssessmentPanel key={`checks-${topicId}`} topicId={topicId} days={overview.days} results={overview.assessments ?? []} disabled={busy || taskBusy} refresh={refresh} />
      <div className="learning-section-heading"><h3>学习资料 · {overview.materials.length}</h3><button disabled={busy || taskBusy} onClick={() => void importFile()}>导入 PDF / Markdown</button></div>
      <button disabled={busy || taskBusy || !overview.materials.length} onClick={() => { setBusy(true); setError(""); void request<{ indexed: number }>({ type: "semantic-index", topicId }).then((value) => setResult(`已建立 ${value.indexed} 个片段的本机语义索引。`)).catch((problem) => setError(problem.message)).finally(() => setBusy(false)); }}>构建本机语义索引</button>
      {overview.materials.length ? <ul className="material-list">{overview.materials.map((item) => <li key={item.id}><span>{item.name}</span><small>{({ indexed: "可检索", ocr_low_confidence: "需核对 OCR", ocr_required: "待 OCR", parse_failed: "解析失败", rejected: "未导入" } as Record<string, string>)[item.status] ?? item.status}</small></li>)}</ul> : <p className="learning-empty">导入你希望参考的资料，开启会话授权后，知行会检索并提供原文出处。</p>}
      {busy && <p role="status">正在处理… <button onClick={() => void request({ type: "learning-cancel" })}>取消当前操作</button></p>}
      {result && <div className="learning-result" role="status">{result}</div>}
      <div className="modal-actions"><button disabled={busy || taskBusy} className="primary" onClick={() => onDiscuss("请结合当前学习进度和资料，讲解今天的核心概念，并用一个例子串联。")}>回到对话继续学习</button></div>
    </>}
  </div>;
}
