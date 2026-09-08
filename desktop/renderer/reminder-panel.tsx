import { useEffect, useState } from "react";
import type { DesktopCommand } from "../core/contracts.js";
async function request<T>(command: DesktopCommand): Promise<T> { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data as T; }
type Reminder = { time: string; enabled: boolean } | null;
export function ReminderPanel({ topicId, disabled }: { topicId: string; disabled: boolean }) {
  const [plan, setPlan] = useState<Reminder>(); const [time, setTime] = useState("20:30"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { let current = true; void request<Reminder>({ type: "reminder-status", topicId }).then(value => { if (current) { setPlan(value); if (value) setTime(value.time); } }).catch(() => { if (current) setError("提醒设置未能读取。"); }); return () => { current = false; }; }, [topicId]);
  async function save(enabled: boolean) { setBusy(true); setError(""); try { setPlan(await request<Reminder>({ type: "reminder-save", topicId, time, enabled })); } catch { setError("提醒设置未能保存，请重试。"); } finally { setBusy(false); } }
  return <details className="learning-section reminder-panel"><summary>复习提醒</summary>
    <p>应用运行时按本机时间提醒，每个主题每天最多一次，多主题合并通知。错过超过五分钟不补发；应用退出后不会提醒。系统通知权限决定能否显示。</p>
    <label>复习提醒时间<input type="time" aria-label="复习提醒时间" value={time} disabled={disabled || busy} onChange={event => setTime(event.target.value)} /></label>
    <button disabled={disabled || busy || !time || plan === undefined} onClick={() => void save(true)}>保存复习提醒</button>
    <button disabled={disabled || busy || !plan?.enabled} onClick={() => void save(false)}>关闭复习提醒</button>
    <p role="status">{plan?.enabled ? `每天 ${plan.time} 提醒一次` : "复习提醒已关闭"}</p>{error && <p role="alert">{error}</p>}
  </details>;
}
