import { useState } from "react";
import type { BootState } from "../core/contracts.js";

export function BackupPanel({ disabled, onRestored }: { disabled: boolean; onRestored: (state: BootState) => void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function run(type: "workspace-backup" | "workspace-restore") {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await window.zhixing.invoke({ type }); if (!result.ok) throw new Error(result.error);
      const data = result.data as { cancelled?: boolean; path?: string; workspace?: string; sessions?: number; state?: BootState };
      if (!data.cancelled) { setMessage(data.path ? `备份已保存：${data.path}` : `已恢复 ${data.sessions} 段对话，新工作区：${data.workspace}`); if (data.state) onRestored(data.state); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : "备份操作未完成"); }
    finally { setBusy(false); }
  }
  return <section className="setting-section"><h3>数据备份与恢复</h3><p className="modal-description">备份当前工作区的资料、课程、技能、学习记录、数据库及此设备的全部对话和偏好。密钥不包含在备份中。恢复会建立新工作区与新会话，保留当前偏好。</p>
    <div className="backup-actions"><button disabled={disabled || busy} onClick={() => void run("workspace-backup")}>备份全部学习数据</button><button disabled={disabled || busy} onClick={() => void run("workspace-restore")}>从备份恢复</button>{busy && <button onClick={() => void window.zhixing.invoke({ type: "learning-cancel" })}>取消备份操作</button>}</div>
    {busy && <p role="status">正在处理数据…</p>}{message && <p role="status" className="backup-result">{message}</p>}{error && <p role="alert" className="message-error">{error}</p>}
  </section>;
}
