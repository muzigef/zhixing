import { DiagnosticsPanel } from "./diagnostics-panel.js";
import {
  StrictMode,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type {
  BootState,
  ChatMessage,
  ChatSession,
  DesktopBridge,
  DesktopCommand,
  DesktopSettings,
  SessionSummary,
} from "../core/contracts.js";
import "katex/dist/katex.min.css";
import "./styles.css";
import { LearningPanel } from "./learning-panel.js";
import type { Citation } from "../../src/contracts.js";
import type { LearningSource } from "../../src/learning-contracts.js";

declare global {
  interface Window {
    zhixing: DesktopBridge;
  }
}
async function invoke<T>(command: DesktopCommand): Promise<T> {
  const result = await window.zhixing.invoke(command);
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}
const styleNames = {
  concise: "简洁",
  adaptive: "自然",
  detailed: "深入",
} as const;
const ideas = [
  {
    icon: BookOpen,
    title: "学懂一个概念",
    detail: "从直觉出发，把复杂知识讲明白",
    prompt:
      "我想学懂一个新概念。请先问我想学什么、目前了解多少，再用直观例子逐步讲解。",
  },
  {
    icon: FlaskConical,
    title: "把知识用起来",
    detail: "拆解问题，一起完成一次小实践",
    prompt:
      "我想通过动手实践学习。请先了解我的目标和基础，再带我完成一个可以验证结果的小练习。",
  },
  {
    icon: MessageSquare,
    title: "梳理我的思路",
    detail: "带着问题来，在对话中找到方向",
    prompt: "我有一些想法需要梳理。请先听我描述，再帮我找到关键问题和下一步。",
  },
];
function Brand({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark ${large ? "large" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M10 11h7.5a5 5 0 0 1 5 5v15H15a5 5 0 0 0-5 1V11Z"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M22.5 19c0-4.5 3-7 7.5-7v20c-2.7-1.2-5.2-1.3-7.5-1M14 18h4M14 23h4"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="m29 5 1.2 3.3L34 9.5l-3.8 1.2L29 14l-1.2-3.3L24 9.5l3.8-1.2L29 5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function App() {
  const [boot, setBoot] = useState<BootState>();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => readDrafts().new ?? "");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [contextAllowed, setContextAllowed] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [source, setSource] = useState<LearningSource>();
  const [contextOpen, setContextOpen] = useState(false);
  const currentId = useRef<string | null>(null);
  const draftRef = useRef("");
  const input = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const drafts = useRef<Record<string, string>>(readDrafts());
  const selecting = useRef(0);
  const settingsRevision = useRef(0);
  const hasMessages = Boolean(session?.messages.length);
  const isCurrentRunning = activeId !== null && activeId === session?.id;
  const settings = boot?.settings ?? {
    provider: "pi-codex",
    style: "adaptive",
    theme: "system",
    deepseekModel: "deepseek-v4-flash",
  };
  const notify = (text: string) => {
    setToast(text);
  };
  const updateSession = (value: ChatSession) => {
    setBoot((previous) =>
      previous
        ? { ...previous, sessions: mergeSummary(previous.sessions, value) }
        : previous,
    );
    if (value.id === currentId.current) setSession(value);
  };
  const select = useCallback(async (id: string) => {
    const serial = ++selecting.current;
    try {
      const value = await invoke<ChatSession>({ type: "load", sessionId: id });
      if (serial !== selecting.current) return;
      currentId.current = id;
      localStorage.setItem("last-session", id);
      setSession(value);
      setSelectedTopic(value.topicId ?? "");
      setContextAllowed(value.contextAllowed ?? false);
      setDraft(drafts.current[id] ?? "");
      setError("");
      setMenuOpen(false);
      stickToBottom.current = true;
      setAtBottom(true);
      requestAnimationFrame(() => input.current?.focus());
    } catch (problem) {
      setError(messageOf(problem));
    }
  }, []);
  const refresh = useCallback(async () => {
    const value = await invoke<BootState>({ type: "boot" });
    setBoot(value);
    setActiveId(value.activeSessionId);
    return value;
  }, []);
  useEffect(() => {
    const unsubscribe = window.zhixing.subscribe((event) => {
      if (event.type === "session") {
        updateSession(event.session);
        if (event.session.messages.at(-1)?.status === "running")
          setActiveId(event.session.id);
      } else if (event.type === "delta") {
        if (event.sessionId === currentId.current)
          setSession((previous) =>
            previous?.id === event.sessionId
              ? {
                  ...previous,
                  messages: previous.messages.map((message) =>
                    message.id === event.messageId
                      ? { ...message, text: message.text + event.text }
                      : message,
                  ),
                }
              : previous,
          );
      } else {
        setActiveId((previous) =>
          previous === event.sessionId ? null : previous,
        );
      }
    });
    void refresh()
      .then((value) => {
        const last = localStorage.getItem("last-session");
        const id =
          value.sessions.find((item) => item.id === last)?.id ??
          value.sessions[0]?.id;
        if (id) void select(id);
        else setDraft(drafts.current.new ?? "");
      })
      .catch((problem) => setError(messageOf(problem)));
    return unsubscribe;
  }, [refresh, select]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    draftRef.current = draft;
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
    }
    drafts.current[currentId.current ?? "new"] = draft;
    try {
      localStorage.setItem("drafts", JSON.stringify(drafts.current));
    } catch {
      /* The current draft remains in memory. */
    }
  }, [draft, session?.id]);
  useEffect(() => {
    if (stickToBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [session?.messages, session?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!isCurrentRunning) return;
    const update = () =>
      setElapsed(
        Math.floor(
          (Date.now() -
            new Date(
              session?.messages.at(-1)?.createdAt ?? Date.now(),
            ).getTime()) /
            1000,
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isCurrentRunning, session?.id, session?.messages.length]);
  const newChat = useCallback(() => {
    selecting.current++;
    currentId.current = null;
    localStorage.removeItem("last-session");
    setSession(null);
    setDraft(drafts.current.new ?? "");
    setError("");
    setMenuOpen(false);
    requestAnimationFrame(() => input.current?.focus());
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newChat();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
      if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [newChat]);
  async function send(
    text = draftRef.current,
    providerOverride?: DesktopSettings["provider"],
    steer = false,
  ) {
    if (!text.trim() || sending) return;
    if (activeId) {
      if (activeId !== session?.id) { setError("另一个会话正在运行，请先切换到该会话或停止任务。"); return; }
      setSending(true); setDraft("");
      try {
        await invoke({ type: "enqueue", sessionId: activeId, text, provider: providerOverride ?? settings.provider, style: settings.style, steer });
        notify(steer ? "已收到调整，将结合原任务继续" : "已加入待发送队列");
      } catch (problem) { setError(messageOf(problem)); setDraft((previous) => previous || text); }
      finally { setSending(false); }
      return;
    }
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      let target = session;
      if (!target) {
        target = await invoke<ChatSession>({ type: "new" });
        currentId.current = target.id;
        localStorage.setItem("last-session", target.id);
        setSession(target);
        setBoot((previous) =>
          previous
            ? {
                ...previous,
                sessions: mergeSummary(previous.sessions, target!),
              }
            : previous,
        );
      }
      setActiveId(target.id);
      drafts.current[target.id] = "";
      drafts.current.new = "";
      setDraft("");
      await invoke<ChatSession>({
        type: "send",
        sessionId: target.id,
        text,
        provider: providerOverride ?? settings.provider,
        style: settings.style,
        ...(selectedTopic ? { topicId: selectedTopic, contextAllowed } : {}),
      });
    } catch (problem) {
      setError(messageOf(problem));
      setActiveId(null);
      setDraft((previous) => previous || text);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }
  async function saveSettings(value: DesktopSettings) {
    const revision = ++settingsRevision.current;
    setBoot((previous) =>
      previous ? { ...previous, settings: value } : previous,
    );
    try {
      const state = await invoke<BootState>({
        type: "settings",
        settings: value,
      });
      if (revision === settingsRevision.current) setBoot(state);
    } catch (problem) {
      setError(messageOf(problem));
    }
  }
  const sessions =
    boot?.sessions.filter((item) =>
      item.title.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const today = new Date().toDateString();
  const recent = sessions.filter(
    (item) => new Date(item.updatedAt).toDateString() === today,
  );
  const older = sessions.filter(
    (item) => new Date(item.updatedAt).toDateString() !== today,
  );
  function sessionGroup(title: string, list: SessionSummary[]) {
    return list.length ? (
      <div className="session-group">
        <div className="section-label">{title}</div>
        {list.map((item) => (
          <button
            key={item.id}
            className={`session-item ${session?.id === item.id ? "selected" : ""}`}
            onClick={() => void select(item.id)}
            title={item.title}
          >
            <MessageSquare size={15} />
            <span>{item.title}</span>
            {activeId === item.id && <span className="activity-dot" />}
          </button>
        ))}
      </div>
    ) : null;
  }
  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="会话导航">
        <div className="traffic-space" />
        <div className="sidebar-brand">
          <Brand />
          <span>知行</span>
          <span className="brand-caption">桌面版</span>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={17} />
          <span>新对话</span>
          <kbd>{window.zhixing.platform === "darwin" ? "⌘" : "Ctrl"} N</kbd>
        </button>
        <label className="search-box">
          <Search size={15} />
          <input
            ref={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索对话"
            aria-label="搜索对话"
          />
          {search && (
            <IconButton label="清除搜索" onClick={() => setSearch("")}>
              <X size={12} />
            </IconButton>
          )}
        </label>
        <nav className="session-list" aria-label="历史会话">
          {sessionGroup("今天", recent)}
          {sessionGroup("更早", older)}
          {!sessions.length && (
            <div className="empty-history">
              {search ? (
                "没有找到相关对话"
              ) : (
                <>
                  你的思考，值得留存。
                  <br />
                  开始后，对话会保存在这里。
                </>
              )}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" />
            会话保存在此设备
          </div>
          <button
            aria-label="设置"
            className="settings-link"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
            <span>设置</span>
            <kbd>⌘ ,</kbd>
          </button>
        </div>
      </aside>
      <main className="main-pane">
        <header className="titlebar">
          <IconButton
            label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </IconButton>
          <div className="window-title">{session?.title ?? "新对话"}</div>
          <span className="header-label">个人学习空间</span>
          {hasMessages && (
            <div className="session-menu">
              <IconButton
                label="会话选项"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <MoreHorizontal size={20} />
              </IconButton>
              {menuOpen && (
                <>
                  <button
                    className="menu-backdrop"
                    aria-label="关闭会话选项"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="popover">
                    <button disabled={isCurrentRunning} onClick={() => { setContextOpen(true); setMenuOpen(false); }}>任务目标与约束</button>
                    <button
                      disabled={isCurrentRunning}
                      onClick={() => {
                        setRenaming(true);
                        setMenuOpen(false);
                      }}
                    >
                      <Pencil size={15} />
                      重命名对话
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void invoke<{ exported: boolean }>({
                          type: "export",
                          sessionId: session!.id,
                        })
                          .then((result) => {
                            if (result.exported) notify("已导出为 Markdown");
                          })
                          .catch((problem) => setError(messageOf(problem)));
                      }}
                    >
                      <Download size={15} />
                      导出 Markdown
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>
        {boot?.workspace && <div className="learning-toolbar">
          <label>学习主题 <select aria-label="学习主题" value={selectedTopic} disabled={!!activeId} onChange={(event) => {
            if (hasMessages) newChat();
            setSelectedTopic(event.target.value); setContextAllowed(false);
          }}><option value="">自由对话</option>{boot.workspace.topics.map((topic) => <option key={topic.topicId} value={topic.topicId}>{topic.title}</option>)}</select></label>
          <button onClick={() => setLearningOpen(true)}><BookOpen size={14} />课程与资料</button>
          {selectedTopic && <label className="context-permission"><input type="checkbox" checked={contextAllowed} disabled={!!activeId} onChange={(event) => setContextAllowed(event.target.checked)} />本会话使用学习上下文<span title="将当前主题的进度和检索片段提供给你选择的模型。授权仅适用于这段对话。">ⓘ</span></label>}
        </div>}
        {error && (
          <div className="error-banner" role="alert">
            <CircleHelp size={16} />
            <span>{error}</span>
            <button onClick={() => setSettingsOpen(true)}>查看设置</button>
            <IconButton label="关闭提示" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        <div
          className="conversation-scroll"
          ref={scroll}
          onScroll={() => {
            if (!scroll.current) return;
            const element = scroll.current;
            const bottom =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
            stickToBottom.current = bottom;
            setAtBottom(bottom);
          }}
        >
          {!hasMessages ? (
            <section className="welcome">
              <div className="welcome-heading">
                <Brand large />
                <div className="eyebrow">知而后行 · 在对话中成长</div>
                <h1>今天，想探索些什么？</h1>
                <p>带着一个问题开始，把好奇变成理解。</p>
              </div>
              <div className="idea-grid">
                {ideas.map((idea) => (
                  <button
                    className="idea-card"
                    key={idea.title}
                    onClick={() => {
                      setDraft(idea.prompt);
                      input.current?.focus();
                    }}
                  >
                    <idea.icon size={21} strokeWidth={1.6} />
                    <strong>{idea.title}</strong>
                    <span>{idea.detail}</span>
                    <span className="idea-arrow">↗</span>
                  </button>
                ))}
              </div>
              <div className="welcome-footnote">
                <Sparkles size={14} />
                跟随你的节奏，简短交流或深入讨论
              </div>
            </section>
          ) : (
            <div className="messages" aria-label="对话内容">
              {session?.messages.map((message, index) => (
                <Message
                  key={message.id}
                  message={message}
                  elapsed={elapsed}
                  onCopy={(text) => {
                    void invoke({ type: "copy", text })
                      .then(() => notify("已复制"))
                      .catch((problem) => setError(messageOf(problem)));
                  }}
                  onRetry={() =>
                    void send(
                      session.messages
                        .slice(0, index)
                        .reverse()
                        .find((item) => item.role === "user")?.text ?? "请继续",
                    )
                  }
                  onContinue={() =>
                    void send("请从刚才停止的地方继续，避免重复已讲过的内容。")
                  }
                  onSwitch={() => {
                    void saveSettings({
                      ...settings,
                      provider: "deepseek-api",
                    }).then(() =>
                      send(
                        session.messages
                          .slice(0, index)
                          .reverse()
                          .find((item) => item.role === "user")?.text ??
                          "请继续",
                        "deepseek-api",
                      ),
                    );
                  }}
                  canSend={!activeId && !sending}
                  onSource={(citation) => {
                    void invoke<LearningSource>({ type: "learning-source", topicId: session.topicId ?? citation.topicId, citation }).then(setSource).catch((problem) => setError(messageOf(problem)));
                  }}
                  onOpenLink={(url) => {
                    void invoke({ type: "open-link", url }).catch((problem) =>
                      setError(messageOf(problem)),
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="composer-region">
          {!!session?.pendingRequests?.length && <div className="pending-requests" aria-label="待发送消息">
            <div><strong>{isCurrentRunning && !session.queuePaused ? "接下来" : "已暂停的待办"} · {session.pendingRequests.length}</strong>{!activeId && <button onClick={() => void invoke({ type: "resume-queue", sessionId: session.id }).catch((problem) => setError(messageOf(problem)))}>继续待办</button>}</div>
            {session.queueError && <p role="alert">{session.queueError}</p>}
            {session.pendingRequests.map((item) => <div key={item.id}><span>{item.text}</span><button aria-label={`撤回 ${item.text.slice(0, 30)}`} onClick={() => void invoke({ type: "withdraw", sessionId: session.id, requestId: item.id }).catch((problem) => setError(messageOf(problem)))}>撤回</button></div>)}
          </div>}
          {!atBottom && hasMessages && (
            <button
              className="scroll-bottom"
              onClick={() => {
                stickToBottom.current = true;
                scroll.current?.scrollTo({
                  top: scroll.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              <ArrowDown size={15} />
              回到最新
            </button>
          )}
          {activeId && !isCurrentRunning && (
            <div className="other-run">
              另一个会话正在生成回答。
              <button onClick={() => void select(activeId)}>返回查看</button>
            </div>
          )}
          <form
            className={`composer ${isCurrentRunning ? "is-running" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={20_000}
              rows={2}
              aria-label="发送给知行"
              placeholder={
                hasMessages
                  ? "继续追问，或者换个思路…"
                  : "问一个问题，或说说你的学习目标…"
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-toolbar">
              <button
                type="button"
                className="model-picker"
                onClick={() => setSettingsOpen(true)}
              >
                <span
                  className={`model-dot ${settings.provider === "demo" ? "demo" : ""}`}
                />
                <span>
                  {settings.provider === "demo"
                    ? "离线演示"
                    : settings.provider === "deepseek-api"
                      ? `DeepSeek · ${settings.deepseekModel.replace("deepseek-", "")}`
                      : (boot?.model.model ?? "Pi · Codex")}
                </span>
                <ChevronDown size={13} />
              </button>
              <label className="style-picker">
                <span className="sr-only">回答风格</span>
                <select
                  aria-label="回答风格"
                  value={settings.style}
                  onChange={(event) =>
                    void saveSettings({
                      ...settings,
                      style: event.target.value as DesktopSettings["style"],
                    })
                  }
                >
                  {Object.entries(styleNames).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="composer-spacer" />
              {isCurrentRunning && <>
                <button type="button" className="queue-button" disabled={!draft.trim() || sending} onClick={() => void send()}>排队</button>
                <button type="button" className="queue-button" disabled={!draft.trim() || sending} onClick={() => void send(draftRef.current, undefined, true)}>立即调整</button>
              </>}
              {draft.length > 18_000 && (
                <span className="char-count">{draft.length}/20000</span>
              )}
              {isCurrentRunning ? (
                <button
                  type="button"
                  className="send-button stop"
                  aria-label="停止生成"
                  title="停止生成"
                  onClick={() =>
                    void invoke({ type: "stop" }).catch((problem) =>
                      setError(messageOf(problem)),
                    )
                  }
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={!draft.trim() || !!activeId || sending || !boot}
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-caption">
            <span>
              {settings.provider === "demo"
                ? "离线演示不会调用真实模型"
                : settings.provider === "deepseek-api"
                  ? "通过 DeepSeek API 直接连接"
                  : "使用你在 Pi 中配置的 Codex 模型"}
            </span>
            <span>{isCurrentRunning ? "Enter 排队" : "Enter 发送"} · Shift + Enter 换行</span>
          </div>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          model={boot?.model}
          api={boot?.api}
          onConfigure={async (apiKey) => {
            const state = await invoke<BootState>({
              type: "configure-deepseek",
              apiKey,
            });
            setBoot(state);
          }}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onRefresh={() => refresh().then(() => undefined)}
        />
      )}
      {renaming && session && (
        <RenameDialog
          title={session.title}
          onClose={() => setRenaming(false)}
          onSave={async (title) => {
            try {
              const updated = await invoke<ChatSession>({
                type: "rename",
                sessionId: session.id,
                title,
              });
              updateSession(updated);
              setRenaming(false);
            } catch (problem) {
              setError(messageOf(problem));
            }
          }}
        />
      )}
      {learningOpen && boot?.workspace && <Modal title="课程与资料" className="learning-modal" onClose={() => setLearningOpen(false)}>
        <LearningPanel workspace={boot.workspace} topicId={selectedTopic} busy={!!activeId} onWorkspace={(value) => { setBoot(value); newChat(); setSelectedTopic(""); setContextAllowed(false); }} onDiscuss={(text) => { setLearningOpen(false); setDraft(text); input.current?.focus(); }} />
      </Modal>}
      {source && <Modal title={`资料来源 · ${source.citation.documentName}`} className="learning-modal" onClose={() => setSource(undefined)}>
        <p>{source.citation.pageNumber ? `第 ${source.citation.pageNumber} 页` : source.citation.anchor ?? "文档开头"}</p><pre className="source-excerpt">{source.text}</pre>{source.truncated && <p>当前展示部分原文，可用更具体的问题继续检索。</p>}
      </Modal>}
      {contextOpen && session && <ContextDialog session={session} onClose={() => setContextOpen(false)} onSave={async (goal, notes) => {
        try { await invoke({ type: "context", sessionId: session.id, goal, notes }); setContextOpen(false); }
        catch (problem) { setError(messageOf(problem)); }
      }} />}
    </div>
  );
}
const Message = memo(
  function Message({
    message,
    elapsed,
    onCopy,
    onRetry,
    onContinue,
    onSwitch,
    canSend,
    onOpenLink,
    onSource,
  }: {
    message: ChatMessage;
    elapsed: number;
    onCopy: (text: string) => void;
    onRetry: () => void;
    onContinue: () => void;
    onSwitch: () => void;
    canSend: boolean;
    onOpenLink: (url: string) => void;
    onSource: (citation: Citation) => void;
  }) {
    if (message.role === "user")
      return (
        <article className="message user-message">
          <div className="user-bubble">{message.text}</div>
        </article>
      );
    return (
      <article className="message assistant-message">
        <div className="assistant-label">
          <Brand />
          <strong>知行</strong>
          {message.provider && (
            <span className="demo-badge">
              {message.provider === "demo"
                ? "离线演示"
                : message.provider === "deepseek-api"
                  ? "DeepSeek API"
                  : "Pi · Codex"}
            </span>
          )}
        </div>
        {!!message.activities?.length && <details className="task-activities"><summary>任务进展 · {message.activities.length} 项活动</summary><ul>{message.activities.map((activity, index) => <li key={index}>{activity.status === "completed" ? "✓" : activity.status === "failed" ? "!" : "…"} {activity.label}</li>)}</ul></details>}
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href) onOpenLink(href);
                  }}
                >
                  {children}
                  <ExternalLink size={11} />
                </a>
              ),
              img: ({ alt }) => (
                <span className="image-placeholder">
                  {alt ? `[图片：${alt}]` : "[图片]"}
                </span>
              ),
              pre: ({ children }) => (
                <CodeBlock onCopy={onCopy}>{children}</CodeBlock>
              ),
            }}
          >
            {message.text}
          </Markdown>
        </div>
        {!!message.citations?.length && <div className="source-list" aria-label="资料来源">{message.citations.map((citation, index) => <button key={index} onClick={() => onSource(citation)}>{index + 1}. {citation.documentName} · {citation.pageNumber ? `第 ${citation.pageNumber} 页` : citation.anchor ?? "原文"}</button>)}</div>}
        {message.status === "running" && (
          <div className="generation-status" role="status">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            {message.text ? "正在回答" : "正在思考"}
            <span>{elapsed} 秒</span>
          </div>
        )}
        {message.error && (
          <div className="message-error">
            <CircleHelp size={15} />
            <span>{message.error}</span>
          </div>
        )}
        {message.status !== "running" && (
          <div className="message-actions">
            <IconButton
              label="复制回答"
              disabled={!message.text}
              onClick={() => onCopy(message.text)}
            >
              <Copy size={14} />
            </IconButton>
            {(message.status === "failed" ||
              message.status === "interrupted") && (
              <button disabled={!canSend} onClick={onRetry}>
                <RefreshCw size={13} />
                重试
              </button>
            )}
            {message.status === "failed" && message.provider === "pi-codex" && (
              <button disabled={!canSend} onClick={onSwitch}>
                切换到 DeepSeek 重试
              </button>
            )}
            {message.status === "interrupted" && (
              <>
                <span>已停止</span>
                <button disabled={!canSend} onClick={onContinue}>
                  继续回答
                </button>
              </>
            )}
            {message.status === "completed" &&
              message.durationMs !== undefined && (
                <span>
                  {(message.durationMs / 1000).toFixed(1)} 秒
                  {message.firstTokenMs !== undefined
                    ? ` · 首字 ${(message.firstTokenMs / 1000).toFixed(1)} 秒`
                    : ""}
                </span>
              )}
          </div>
        )}
      </article>
    );
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.canSend === next.canSend &&
    (next.message.status !== "running" || previous.elapsed === next.elapsed),
);
function CodeBlock({
  children,
  onCopy,
}: {
  children: ReactNode;
  onCopy: (text: string) => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <div className="code-header">
        <span>代码</span>
        <button onClick={() => onCopy(ref.current?.textContent ?? "")}>
          <Copy size={12} />
          复制
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
function Modal({
  children,
  title,
  onClose,
  className = "",
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const element = ref.current;
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <IconButton label="关闭" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
function SettingsDialog({
  settings,
  model,
  api,
  onConfigure,
  onClose,
  onSave,
  onRefresh,
}: {
  settings: DesktopSettings;
  model?: BootState["model"];
  api?: BootState["api"];
  onConfigure: (key: string) => Promise<void>;
  onClose: () => void;
  onSave: (value: DesktopSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savedKey, setSavedKey] = useState(false);
  const refreshButton = (
    <button
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        setFailure("");
        void onRefresh()
          .catch((problem) => setFailure(messageOf(problem)))
          .finally(() => setRefreshing(false));
      }}
    >
      <RefreshCw size={13} className={refreshing ? "spinning" : ""} />
      {refreshing ? "刷新中" : "刷新"}
    </button>
  );
  return (
    <Modal title="设置" onClose={onClose} className="settings-modal">
      <p className="modal-description">让知行适应你的学习方式。</p>
      <div className="setting-section">
        <h3>对话模型</h3>
        <div className="provider-options">
          <button
            className={`provider-option ${settings.provider === "pi-codex" ? "chosen" : ""}`}
            onClick={() => void onSave({ ...settings, provider: "pi-codex" })}
          >
            <span className="provider-icon">
              <Sparkles size={19} />
            </span>
            <span>
              <strong>Pi · Codex</strong>
              <small>沿用 Pi 的模型配置与登录</small>
            </span>
            {settings.provider === "pi-codex" && <Check size={17} />}
          </button>
          <button
            className={`provider-option ${settings.provider === "deepseek-api" ? "chosen" : ""}`}
            onClick={() =>
              void onSave({ ...settings, provider: "deepseek-api" })
            }
          >
            <span className="provider-icon">
              <MessageSquare size={19} />
            </span>
            <span>
              <strong>DeepSeek API</strong>
              <small>直接连接 API，复用已有知行配置</small>
            </span>
            {settings.provider === "deepseek-api" && <Check size={17} />}
          </button>
          <button
            className={`provider-option ${settings.provider === "demo" ? "chosen" : ""}`}
            onClick={() => void onSave({ ...settings, provider: "demo" })}
          >
            <span className="provider-icon">
              <FlaskConical size={19} />
            </span>
            <span>
              <strong>离线演示</strong>
              <small>无需联网，体验界面与交互</small>
            </span>
            {settings.provider === "demo" && <Check size={17} />}
          </button>
        </div>
        {settings.provider === "pi-codex" && (
          <div className="model-status">
            <div className="model-status-heading">
              <span
                className={`status-dot ${model?.configured ? "" : "muted"}`}
              />
              <strong>{model?.model ?? "尚未配置 Codex 模型"}</strong>
              {refreshButton}
            </div>
            {model?.thinking && <p>推理深度：{model.thinking}</p>}
            <p>{failure || model?.message || "正在读取配置…"}</p>
            <details>
              <summary>如何连接 Pi？</summary>
              <p>
                在 Pi 中选择 OpenAI Codex 模型，并通过 <code>/login</code>{" "}
                完成登录。回到这里点击刷新，即可继承已有配置。应用已包含 Pi
                运行环境。
              </p>
              <p>也可以直接切换到 DeepSeek API 使用。</p>
            </details>
          </div>
        )}
        {settings.provider === "deepseek-api" && (
          <div className="model-status">
            <div className="model-status-heading">
              <span
                className={`status-dot ${api?.configured ? "" : "muted"}`}
              />
              <strong>
                {api?.configured ? "已找到 API 配置" : "添加 API 配置"}
              </strong>
              {refreshButton}
            </div>
            <p>{failure || api?.message}</p>
            <label className="api-model-row">
              <span>模型</span>
              <select
                aria-label="DeepSeek 模型"
                value={settings.deepseekModel}
                onChange={(event) =>
                  void onSave({
                    ...settings,
                    deepseekModel: event.target.value,
                  })
                }
              >
                <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              </select>
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSavingKey(true);
                setFailure("");
                setSavedKey(false);
                void onConfigure(apiKey)
                  .then(() => {
                    setApiKey("");
                    setSavedKey(true);
                  })
                  .catch((problem) => setFailure(messageOf(problem)))
                  .finally(() => setSavingKey(false));
              }}
            >
              <label className="api-key-label" htmlFor="deepseek-api-key">
                {api?.configured ? "更新 API Key（可选）" : "API Key"}
              </label>
              <div className="api-key-input">
                <input
                  id="deepseek-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setSavedKey(false);
                  }}
                  placeholder={
                    api?.configured
                      ? "已有配置，无需重复填写"
                      : "粘贴你的 DeepSeek API Key"
                  }
                />
                <button disabled={savingKey || apiKey.trim().length < 8}>
                  {savingKey ? "保存中" : "保存"}
                </button>
              </div>
              <p>
                {savedKey
                  ? "已加密保存 API Key。"
                  : "密钥由系统加密保护，不写入聊天记录。"}
              </p>
            </form>
          </div>
        )}
      </div>
      <div className="setting-section">
        <h3>偏好</h3>
        <label className="setting-row">
          <span>
            <strong>回答风格</strong>
            <small>你也可以在对话中直接提出要求</small>
          </span>
          <select
            aria-label="默认回答风格"
            value={settings.style}
            onChange={(event) =>
              void onSave({
                ...settings,
                style: event.target.value as DesktopSettings["style"],
              })
            }
          >
            {Object.entries(styleNames).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>外观</strong>
            <small>选择适合当前环境的主题</small>
          </span>
          <select
            aria-label="外观"
            value={settings.theme}
            onChange={(event) =>
              void onSave({
                ...settings,
                theme: event.target.value as DesktopSettings["theme"],
              })
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
      <DiagnosticsPanel />
      <div className="settings-footer">
        <Brand />
        <span>
          知行桌面版
          <small>
            会话与偏好保存在此设备；选择联网模型时，会发送当前对话的有限上下文。
          </small>
        </span>
      </div>
    </Modal>
  );
}
function ContextDialog({ session, onClose, onSave }: { session: ChatSession; onClose: () => void; onSave: (goal: string, notes: string) => Promise<void> }) {
  const [goal, setGoal] = useState(session.context?.goal ?? "");
  const [notes, setNotes] = useState(session.context?.notes ?? "");
  return <Modal title="任务目标与约束" onClose={onClose}>
    <p className="modal-description">在这段对话中持续保留，切换模型或重启后仍然有效。最新明确纠正优先。</p>
    <label className="context-field">任务目标<textarea aria-label="任务目标" maxLength={4000} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
    <label className="context-field">明确约束与偏好<textarea aria-label="明确约束与偏好" maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：用中文解释；先给结论；保留引用" /></label>
    {session.context?.summary && <details className="task-activities"><summary>较早对话的摘要</summary><p>{session.context.summary}</p></details>}
    <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => void onSave(goal, notes)}>保存</button></div>
  </Modal>;
}
function RenameDialog({
  title,
  onSave,
  onClose,
}: {
  title: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(title);
  return (
    <Modal title="重命名对话" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSave(value);
        }}
      >
        <input
          className="rename-input"
          aria-label="对话名称"
          autoFocus
          value={value}
          maxLength={80}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!value.trim()}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
function mergeSummary(
  sessions: SessionSummary[],
  session: ChatSession,
): SessionSummary[] {
  const { id, title, createdAt, updatedAt } = session;
  return [
    { id, title, createdAt, updatedAt },
    ...sessions.filter((item) => item.id !== id),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : "操作未完成，请重试。";
}
function readDrafts(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("drafts") ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            ([key, text]) =>
              /^(new|[0-9a-f-]{36})$/.test(key) &&
              typeof text === "string" &&
              text.length <= 20_000,
          ),
        )
      : {};
  } catch {
    return {};
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
