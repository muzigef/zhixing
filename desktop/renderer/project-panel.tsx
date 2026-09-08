import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../src/practice-projects.js";
import type { DesktopCommand } from "../core/contracts.js";
async function request<T>(command: DesktopCommand): Promise<T> { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data as T; }
type ProjectList = { projects: { id: string; title: string }[]; selected: string | null };

export function ProjectPanel({ topicId, disabled, onDiscuss }: { topicId: string; disabled: boolean; onDiscuss: (text: string) => void }) {
  const [list, setList] = useState<ProjectList>({ projects: [], selected: null }); const [project, setProject] = useState<ProjectSnapshot>();
  const [title, setTitle] = useState(""); const [file, setFile] = useState<{ path: string; content: string; hash: string | null }>(); const [draft, setDraft] = useState(""); const [newName, setNewName] = useState("");
  const [preview, setPreview] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function refresh() {
    const value = await request<ProjectList>({ type: "project-list", topicId }); setList(value);
    setProject(value.selected ? await request<ProjectSnapshot>({ type: "project-view", topicId, projectId: value.selected }) : undefined);
  }
  useEffect(() => { let current = true; void request<ProjectList>({ type: "project-list", topicId }).then(async value => {
    const selected = value.selected ? await request<ProjectSnapshot>({ type: "project-view", topicId, projectId: value.selected }) : undefined;
    if (current) { setList(value); setProject(selected); }
  }).catch(() => { if (current) setError("无法读取实践项目。"); }); return () => { current = false; }; }, [topicId]);
  async function action(run: () => Promise<void>) { setBusy(true); setError(""); try { await run(); } catch (problem) { setError(problem instanceof Error ? problem.message : "项目操作未完成。"); } finally { setBusy(false); } }
  const locked = busy || disabled;
  return <details className="learning-section project-panel"><summary>项目实践 · {list.projects.length}</summary>
    <p>每个项目都有独立文件目录和本地 Git 仓库。支持有限大小的 JavaScript、JSON、Markdown 与文本；导入只复制文件，不修改原目录。测试只运行本机隔离环境中的 .test.mjs。</p>
    <label>项目名称<input aria-label="实践项目名称" value={title} maxLength={80} disabled={locked} onChange={event => setTitle(event.target.value)} /></label>
    <div className="interaction-actions"><button disabled={locked || !title.trim()} onClick={() => void action(async () => { await request({ type: "project-create", topicId, title }); setTitle(""); setFile(undefined); setPreview(""); await refresh(); })}>创建独立项目</button>
      <button disabled={locked || !title.trim()} onClick={() => void action(async () => { const result = await request<{ cancelled?: boolean }>({ type: "project-import", topicId, title }); if (!result.cancelled) { setTitle(""); setFile(undefined); setPreview(""); await refresh(); } })}>导入文本项目副本</button></div>
    {!!list.projects.length && <label>当前实践项目<select aria-label="当前实践项目" disabled={locked} value={list.selected ?? ""} onChange={event => { const id = event.target.value || null; void action(async () => { await request({ type: "project-select", topicId, projectId: id }); setFile(undefined); setPreview(""); await refresh(); }); }}><option value="">不连接项目</option>{list.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    {project && <>
      <p>{project.title} · {project.branch}</p><p>项目哈希：<code>{project.treeHash}</code></p>
      <div className="interaction-actions"><button disabled={locked} onClick={() => void action(refresh)}>刷新项目状态</button><button disabled={locked} onClick={() => void action(async () => { await request({ type: "project-test", topicId, projectId: project.id, expectedTreeHash: project.treeHash }); await refresh(); })}>运行项目测试</button>
        <button disabled={locked || !project.currentTestsPassed} onClick={() => void action(async () => { await request({ type: "project-checkpoint", topicId, projectId: project.id, expectedTreeHash: project.treeHash, title: "保存已验证的实践进展" }); await refresh(); })}>保存 Git 检查点</button></div>
      <p role="status">{project.currentTestsPassed ? "当前项目测试通过" : "当前文件尚无有效的通过记录"}。通过这些测试不等于掌握知识。</p>
      {project.test && <details><summary>最近实际测试结果</summary><p>{project.test.status} · 退出码 {project.test.exitCode ?? "无"} · {project.test.createdAt}</p><pre>{project.test.stdout}{project.test.stderr}</pre></details>}
      <ul className="material-list">{project.files.map(item => <li key={item.path}><button disabled={locked} onClick={() => void action(async () => { const value = await request<{ path: string; content: string; hash: string }>({ type: "project-read", topicId, projectId: project.id, path: item.path }); setFile(value); setDraft(value.content); setPreview(""); })}>{item.path}</button><small>{item.bytes} 字节</small></li>)}</ul>
      <label>新文件路径<input aria-label="实践新文件路径" value={newName} disabled={locked} onChange={event => setNewName(event.target.value)} /></label><button disabled={locked || !newName.trim()} onClick={() => { setFile({ path: newName.trim(), content: "", hash: null }); setDraft(""); setPreview(""); }}>编写新文件</button>
      {file && <><label>{file.path}<textarea aria-label="实践文件内容" value={draft} rows={12} disabled={locked} onChange={event => { setDraft(event.target.value); setPreview(""); }} /></label>
        <button disabled={locked} onClick={() => void action(async () => { const value = await request<{ preview: string }>({ type: "project-preview", topicId, projectId: project.id, edit: { path: file.path, expectedHash: file.hash, content: draft } }); setPreview(value.preview); })}>预览文件更改</button>
        {preview && <div className="interaction-card"><pre>{preview}</pre><button disabled={locked} onClick={() => void action(async () => { const result = await request<{ hash: string }>({ type: "project-write", topicId, projectId: project.id, edit: { path: file.path, expectedHash: file.hash, content: draft } }); setFile({ ...file, hash: result.hash, content: draft }); setPreview(""); await refresh(); })}>保存本次文件更改</button></div>}
      </>}
      <details><summary>与 Git 检查点的差异</summary><pre>{project.diff || "没有尚未保存的差异。"}</pre></details>
      <details><summary>Git 检查点历史 · {project.history.length}</summary><ul>{project.history.map(item => <li key={item.commit}><code>{item.commit.slice(0, 10)}</code> {item.title}</li>)}</ul></details>
      <button disabled={locked} onClick={() => onDiscuss("请检查当前连接的实践项目，先读取相关文件，分析需要补充的实现和测试。需要修改时列出项目步骤，完成实际测试后再保存 Git 检查点。")}>在对话中改进这个项目</button>
    </>}
    {busy && <p role="status">正在处理项目… <button onClick={() => void request({ type: "learning-cancel" })}>取消项目操作</button></p>}
    {error && <p role="alert" className="message-error">{error}</p>}
  </details>;
}
