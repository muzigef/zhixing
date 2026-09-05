import { useEffect, useState } from "react";
import type { EvidenceKind, EvidenceSnapshot, EvidenceValidation } from "../../src/evidence-store.js";
import type { DesktopCommand } from "../core/contracts.js";

const labels: Record<EvidenceKind, string> = { implementation: "实现产物", testOutput: "测试报告", failureCase: "失败案例", reflection: "复盘", testScript: "测试脚本（JavaScript）" };
async function request<T>(command: DesktopCommand): Promise<T> { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data as T; }
export function EvidencePanel({ topicId, days, disabled, onReview }: { topicId: string; days: { dayId: string; state: string }[]; disabled: boolean; onReview: () => Promise<void> }) {
  const [dayId, setDay] = useState(days.find((day) => day.state === "进行中")?.dayId ?? days[0]?.dayId ?? "");
  const [kind, setKind] = useState<EvidenceKind>("implementation");
  const [text, setText] = useState(""); const [snapshot, setSnapshot] = useState<EvidenceSnapshot>();
  const [busy, setBusy] = useState(false); const [result, setResult] = useState("");
  useEffect(() => { if (!dayId && days.length) setDay(days.find((day) => day.state === "进行中")?.dayId ?? days[0]!.dayId); }, [days, dayId]);
  useEffect(() => { let mounted = true; setSnapshot(undefined); setResult(""); if (dayId) void request<EvidenceSnapshot>({ type: "evidence-list", topicId, dayId }).then((value) => { if (mounted) setSnapshot(value); }).catch((error) => { if (mounted) setResult(error.message); }); return () => { mounted = false; }; }, [topicId, dayId]);
  async function action(type: "evidence-submit" | "evidence-file" | "evidence-review" | "evidence-validate") {
    setBusy(true); setResult("");
    try {
      const value = await request<unknown>({ type, topicId, dayId, kind, text });
      if (type === "evidence-review") { setResult(String(value)); await onReview(); }
      else if (type === "evidence-validate") { const validation = value as EvidenceValidation; setResult(`本地测试：${validation.status} · 退出码 ${validation.exitCode ?? "无"}\n${validation.stdout}\n${validation.stderr}`); }
      else if (!(value as { cancelled?: boolean }).cancelled) { setText(""); setResult("已保存实际产物及内容哈希。"); }
      setSnapshot(await request<EvidenceSnapshot>({ type: "evidence-list", topicId, dayId }));
    } catch (error) { setResult(error instanceof Error ? error.message : "操作未完成"); }
    finally { setBusy(false); }
  }
  return <section className="evidence-panel"><h3>产物与验收</h3>
    {!days.length ? <p>开始一个学习日后，可以提交实现、测试报告与复盘。</p> : <>
      <div className="evidence-selectors"><label>学习日<select aria-label="证据学习日" value={dayId} disabled={busy} onChange={(event) => setDay(event.target.value)}>{days.map((day) => <option key={day.dayId}>{day.dayId}</option>)}</select></label>
      <label>证据类型<select aria-label="证据类型" value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as EvidenceKind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <textarea aria-label="证据内容" placeholder="粘贴实际产物或具体记录，也可以选择文件。" value={text} maxLength={256000} onChange={(event) => setText(event.target.value)} disabled={busy} />
      <div className="evidence-actions"><button disabled={disabled || busy || text.trim().length < 8} onClick={() => void action("evidence-submit")}>保存证据</button><button disabled={disabled || busy} onClick={() => void action("evidence-file")}>选择证据文件</button><button disabled={disabled || busy} onClick={() => void action("evidence-review")}>检查完成证据</button></div>
      <ul className="evidence-list">{Object.entries(labels).map(([key, label]) => { const item = snapshot?.artifacts.findLast((item) => item.kind === key); return <li key={key}><span>{label}</span><small>{item ? item.intact ? `已提交 · ${item.hash.slice(0, 8)}` : "内容已改变，请重交" : "尚未提交"}</small></li>; })}</ul>
      <details><summary>运行本地 JavaScript 测试</summary><p>实现保存为 implementation.mjs；测试使用 node:test，通过 ./implementation.mjs 导入实现。在 macOS 受限环境中运行，禁止网络，10 秒超时。其他平台显示不可用。结果仅证明这组测试的执行情况。</p><button disabled={disabled || busy} onClick={() => void action("evidence-validate")}>运行提交的测试</button></details>
      {snapshot?.validation && <p className="learning-next">最近本地测试：{snapshot.validation.status} · 退出码 {snapshot.validation.exitCode ?? "无"}</p>}
      {busy && <p role="status">正在处理… <button onClick={() => void request({ type: "learning-cancel" })}>取消验证</button></p>}
      {result && <pre className="evidence-result" role="status">{result}</pre>}
      <p className="learning-empty">完整性检查不等于能力评分。用户提交的测试报告会标记为“未复跑”。</p>
    </>}
  </section>;
}
