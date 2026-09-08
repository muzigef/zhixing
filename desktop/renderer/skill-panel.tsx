import { useEffect, useState } from "react";
import type { SkillSummary, SkillDetails } from "../../src/skill-catalog.js";

export function SkillPanel({ topicId, disabled, onDiscuss }: { topicId: string; disabled: boolean; onDiscuss: (text: string) => void }) {
  const [skills, setSkills] = useState<Omit<SkillSummary, "path">[]>([]);
  const [details, setDetails] = useState<SkillDetails>();
  const [selected, setSelected] = useState(""); const [body, setBody] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void window.zhixing.invoke({ type: "skills-list", topicId }).then((result) => { if (!mounted) return; if (result.ok) setSkills(result.data as typeof skills); else setError(result.error); });
    return () => { mounted = false; };
  }, [topicId]);
  useEffect(() => {
    let mounted = true; setBody(""); setDetails(undefined); setError("");
    if (selected) void window.zhixing.invoke({ type: "skill-read", topicId, name: selected }).then((result) => { if (!mounted) return; if (result.ok) { const value = result.data as SkillDetails; setDetails(value); setBody(value.workflow); } else setError(result.error); });
    return () => { mounted = false; };
  }, [selected, topicId]);
  return <section className="skill-panel"><h3>学习技能</h3><p className="modal-description">选择一个工作流程，预览后带入对话。</p>
    {error && <p role="alert">{error}</p>}
    <select aria-label="学习技能" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择技能</option>{skills.map((skill) => <option key={skill.name} value={skill.name}>{skill.name} · {skill.scope === "shared" ? "共享" : "当前主题"}{skill.status === "stale" ? " · 使用旧缓存" : ""}</option>)}</select>
    {skills.some(skill => skill.status === "stale") && <p role="status">技能更新未通过校验，暂用上次有效的目录。流程仅供参考，不改变任何授权。</p>}
    {selected && <>{details && <div className="skill-version"><p>版本：{details.version ?? "未声明"} · 内容 {details.contentHash.slice(0, 12)}</p>{details.status === "stale" && <p role="status">当前显示旧缓存，请核对后使用。</p>}{!!details.conditions.length && <p>适用条件：{details.conditions.join("；")}</p>}{!!details.evaluations.length && <p>关联评测：{details.evaluations.join("、")}（关联不代表已通过）</p>}</div>}<p>{skills.find((skill) => skill.name === selected)?.description}</p><pre className="skill-preview">{body}</pre><button disabled={disabled || !body} onClick={() => onDiscuss(`请使用学习技能“${selected}”帮助我完成当前任务。内容版本 ${details?.contentHash ?? "未知"}${details?.status === "stale" ? "（旧缓存）" : ""}。下面是技能参考流程，请结合我的实际需求使用：\n\n${body.slice(0, 10_000)}`)}>使用这个技能</button></>}
  </section>;
}
