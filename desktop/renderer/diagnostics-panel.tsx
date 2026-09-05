import { useEffect, useState } from "react";
import type { ProviderPerformance } from "../core/diagnostics.js";
import type { ReleaseInfo } from "../core/updates.js";
import type { DesktopCommand } from "../core/contracts.js";
async function request<T>(command: DesktopCommand): Promise<T> { const value = await window.zhixing.invoke(command); if (!value.ok) throw new Error(value.error); return value.data as T; }
const time = (ms?: number) => ms === undefined ? "暂无" : `${(ms / 1000).toFixed(2)} 秒`;
export function DiagnosticsPanel() {
  const [data, setData] = useState<{ version: string; performance: ProviderPerformance[] }>();
  const [release, setRelease] = useState<ReleaseInfo>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let mounted = true; void request<typeof data>({ type: "diagnostics" }).then((value) => { if (mounted) setData(value); }).catch((error) => { if (mounted) setError(error.message); }); return () => { mounted = false; }; }, []);
  return <div className="setting-section"><h3>连接表现与版本 {data?.version}</h3>
    <details className="performance-details"><summary>查看本机耗时统计</summary><p>最近 20 段会话、最多 200 条消息。P50 为中位数，P95 表示 95% 的样本耗时不超过此值。只统计成功回答的耗时，样本少时仅供排查。</p>
    {data?.performance.map((item) => <div className="performance-row" key={item.provider}><strong>{{ "pi-codex": "Pi · Codex", "deepseek-api": "DeepSeek API", demo: "离线演示" }[item.provider]}</strong><p>成功 {item.completed} · 失败 {item.failed} · 中断 {item.interrupted}</p><p>首字 P50 {time(item.firstTokenP50)} / P95 {time(item.firstTokenP95)}<br />整轮 P50 {time(item.durationP50)} · 检索 {time(item.contextP50)} · 模型与工具 {time(item.modelP50)} · 上下文整理 {time(item.compactionP50)}</p></div>)}
    <p>首字时间包含准备与模型等待；Pi 配置已找到不代表登录或连接已成功。</p></details>
    <button disabled={busy} onClick={() => { setBusy(true); setError(""); void request<ReleaseInfo>({ type: "check-updates" }).then(setRelease).catch((error) => setError(error.message)).finally(() => setBusy(false)); }}>{busy ? "正在检查…" : "检查新版本"}</button>
    {release && <p>{release.message} {release.available && release.url && <button onClick={() => void request({ type: "open-link", url: release.url! }).catch((error) => setError(error.message))}>查看发布说明</button>}</p>}
    {error && <p role="alert" className="message-error">{error}</p>}
  </div>;
}
