import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { displayMath } from "../../src/display-math.js";
import { useState } from "react";
import type { ChatMessage } from "../core/contracts.js";
import type { AssistantItem } from "../../src/assistant-interactions.js";

export function InteractionCards({ items, disabled, onAnswer, onCopy }: { items: AssistantItem[]; disabled: boolean; onAnswer: (id: string, answer: string, scope?: "once" | "session") => void; onCopy: (text: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return <div className="interaction-cards">{items.filter((item) => item.kind !== "final").map((item) => {
    if (item.kind === "progress") return <details key={item.id} className="task-activities"><summary>执行说明</summary><p>{item.text}</p></details>;
    if (item.kind === "artifact") return <details key={item.id} className="artifact-card"><summary>已保存 · {item.dayId} · {item.artifactKind}</summary><pre>{item.text}</pre><button onClick={() => onCopy(item.text)}>复制产物</button><small>产物 {item.artifactId}</small></details>;
    return <section key={item.id} className="interaction-card" aria-label={item.kind === "approval" ? "操作授权" : "待回答问题"}>
      <strong>{item.title}</strong>
      {item.kind === "approval" && <details><summary>查看具体操作</summary><pre>{typeof item.input.text === "string" ? `${item.input.dayId} · ${item.input.kind}\n\n${item.input.text}` : JSON.stringify(item.input, null, 2)}</pre></details>}
      {item.status === "answered" ? <p>已处理：{item.answer === "allow" ? "允许" : item.answer === "deny" ? "拒绝" : item.answer}</p> : item.kind === "approval" ? <div className="interaction-actions">
        <button disabled={disabled} onClick={() => onAnswer(item.id, "allow", "once")}>允许这一次</button>
        <button disabled={disabled} onClick={() => onAnswer(item.id, "allow", "session")}>本会话允许</button>
        <button disabled={disabled} onClick={() => onAnswer(item.id, "deny")}>拒绝</button>
      </div> : <form onSubmit={(event) => { event.preventDefault(); if (answers[item.id]?.trim()) onAnswer(item.id, answers[item.id]!); }}>
        <div className="interaction-actions">{item.options.map((option) => <button type="button" disabled={disabled} key={option} onClick={() => onAnswer(item.id, option)}>{option}</button>)}</div>
        <label>你的回复<input aria-label={`回复 ${item.title}`} value={answers[item.id] ?? ""} maxLength={4000} disabled={disabled} onChange={(event) => setAnswers({ ...answers, [item.id]: event.target.value })} /></label>
        <button disabled={disabled || !answers[item.id]?.trim()}>回复并继续</button>
      </form>}
    </section>;
  })}</div>;
}

export function UserMessageEditor({ message, disabled, onSend }: { message: ChatMessage; disabled: boolean; onSend: (text: string) => void }) {
  const [editing, setEditing] = useState(false); const [text, setText] = useState(message.text);
  return <>{editing ? <form className="message-editor" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { onSend(text); setEditing(false); } }}><textarea aria-label="编辑消息" value={text} maxLength={20000} onChange={(event) => setText(event.target.value)} /><button disabled={disabled || !text.trim()}>发送为新分支</button><button type="button" onClick={() => setEditing(false)}>取消</button></form> : <><div className="user-bubble">{message.text}</div><button className="edit-message" disabled={disabled} onClick={() => setEditing(true)}>编辑并重发</button></>}</>;
}

export function CompareAnswers({ messages, onClose }: { messages: ChatMessage[]; onClose: () => void }) {
  const answers = messages.filter((item) => item.role === "assistant" && item.text.trim());
  const [left, setLeft] = useState(answers[0]?.id ?? ""); const [right, setRight] = useState(answers.at(-1)?.id ?? "");
  return <div className="comparison-panel" role="dialog" aria-label="对比回答"><header><strong>对比回答</strong><button onClick={onClose}>关闭对比</button></header><div className="comparison-columns">{[[left, setLeft], [right, setRight]].map(([id, set], column) => <section key={column}><select aria-label={column ? "右侧回答" : "左侧回答"} value={id as string} onChange={(event) => (set as (value: string) => void)(event.target.value)}>{answers.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.model ?? item.provider ?? "回答"} · {item.text.slice(0, 24)}</option>)}</select><div className="comparison-answer markdown"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.zhixing.invoke({ type: "open-link", url: href }); }}>{children}</a>, img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span> }}>{displayMath(answers.find((item) => item.id === id)?.text ?? "暂无回答")}</Markdown></div></section>)}</div></div>;
}
