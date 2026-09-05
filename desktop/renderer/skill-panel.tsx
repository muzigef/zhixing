import { useEffect, useState } from "react";
import type { SkillSummary } from "../../src/skill-catalog.js";

export function SkillPanel({ topicId, disabled, onDiscuss }: { topicId: string; disabled: boolean; onDiscuss: (text: string) => void }) {
  const [skills, setSkills] = useState<Pick<SkillSummary, "name" | "description" | "scope">[]>([]);
  const [selected, setSelected] = useState(""); const [body, setBody] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void window.zhixing.invoke({ type: "skills-list", topicId }).then((result) => { if (!mounted) return; if (result.ok) setSkills(result.data as typeof skills); else setError(result.error); });
    return () => { mounted = false; };
  }, [topicId]);
  useEffect(() => {
    let mounted = true; setBody("");
    if (selected) void window.zhixing.invoke({ type: "skill-read", topicId, name: selected }).then((result) => { if (!mounted) return; if (result.ok) setBody(result.data as string); else setError(result.error); });
    return () => { mounted = false; };
  }, [selected, topicId]);
  return <section className="skill-panel"><h3>学习技能</h3><p className="modal-description">选择一个工作流程，预览后带入对话。</p>
    {error && <p role="alert">{error}</p>}
    <select aria-label="学习技能" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择技能</option>{skills.map((skill) => <option key={skill.name} value={skill.name}>{skill.name} · {skill.scope === "shared" ? "共享" : "当前主题"}</option>)}</select>
    {selected && <><p>{skills.find((skill) => skill.name === selected)?.description}</p><pre className="skill-preview">{body}</pre><button disabled={disabled || !body} onClick={() => onDiscuss(`请使用学习技能“${selected}”帮助我完成当前任务。下面是技能参考流程，请结合我的实际需求使用：\n\n${body.slice(0, 10_000)}`)}>使用这个技能</button></>}
  </section>;
}
