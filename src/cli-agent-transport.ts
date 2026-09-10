import { randomUUID } from "node:crypto";
import { PathPolicy } from "./paths.js";
import { AgentService, type AgentObserver } from "./agent-service.js";
import { AgentSessionStore } from "./agent-session-store.js";
import type { ChatSession, SendRequest } from "./agent-session-contracts.js";
import type { ConversationSession } from "./conversation-session.js";
import type { LearningApplication } from "./learning-application.js";
import type { ModelClient } from "./model.js";

/** CLI history is a compatible projection; the shared service owns execution. */
export class CliAgentTransport {
  readonly service: AgentService;
  private pendingResume?: string;
  private pendingSteerId?: string;
  queued = 0;
  constructor(root: string, application: LearningApplication, client: (provider: SendRequest["provider"]) => ModelClient,
    display: (text: string) => void,
  ) {
    this.service = new AgentService(new AgentSessionStore(new PathPolicy(root).resolveWorkspacePath("zhixing", "agent")), client, application);
    this.service.subscribe(event => { if (event.type === "session") this.queued = event.session.pendingRequests?.length ?? 0; if (event.type === "delta") { if (this.observing) this.activeObserver?.onText?.(event.text, this.provider); else display(event.text); } });
  }
  private observing = false;
  private activeObserver?: AgentObserver;
  private provider = "";
  async recover(chat: ConversationSession): Promise<ConversationSession> {
    try { return await this.projection(chat); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return chat; throw error; }
  }
  async ensure(chat: ConversationSession, inheritLegacy = true): Promise<ChatSession> {
    try { return await this.service.load(chat.id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const now = new Date().toISOString();
    const session: ChatSession = { version: 8, mode: chat.mode, teaching: inheritLegacy ? undefined : null, id: chat.id, title: chat.goal?.slice(0, 80) || "新对话", customTitle: false, createdAt: now, updatedAt: now, topicId: chat.topicId,
      messages: chat.turns.flatMap(turn => [
        { id: randomUUID(), role: "user" as const, text: turn.user, status: "completed" as const, createdAt: now },
        { id: randomUUID(), role: "assistant" as const, text: turn.assistant, status: turn.status === "incomplete" ? "failed" as const : turn.status, createdAt: now },
      ]),
    };
    await this.service.store.save(session); return session;
  }
  async resumeLast(chat: ConversationSession): Promise<void> {
    const previous = (await this.ensure(chat)).messages.at(-1);
    this.pendingResume = previous?.status !== "completed" ? previous?.taskId : undefined;
  }
  async invoke(chat: ConversationSession, request: Omit<SendRequest, "sessionId">, observer: AgentObserver = {}) {
    const session = await this.ensure(chat);
    const previous = session.messages.at(-1);
    const resumeTaskId = request.resumeTaskId ?? this.pendingResume ?? (/^(?:继续|重试|接着)/.test(request.text) && previous?.status !== "completed" ? previous?.taskId : undefined);
    this.pendingResume = undefined;
    const raw = { ...request, sessionId: chat.id, mode: request.mode ?? chat.mode, resumeTaskId, steerId: this.pendingSteerId };
    this.pendingSteerId = undefined;
    this.observing = true; this.activeObserver = observer; this.provider = request.provider;
    try { return await this.service.invoke(raw, { ...observer, onText: undefined }); }
    finally { this.observing = false; this.activeObserver = undefined; }
  }
  interrupt(steer = false): void {
    if (steer) { this.pendingResume = this.service.activeTaskId; this.pendingSteerId = randomUUID(); }
    this.service.stop();
  }
  async projection(chat: ConversationSession): Promise<ConversationSession> {
    const session = await this.service.load(chat.id);
    const turns: ConversationSession["turns"] = [];
    for (let index = 0; index < session.messages.length - 1; index++) {
      const user = session.messages[index]!; const assistant = session.messages[index + 1]!;
      if (user.role !== "user" || assistant.role !== "assistant") continue;
      turns.push({ user: user.text, assistant: assistant.text, status: assistant.status === "blocked" || assistant.status === "waiting" ? "incomplete" : assistant.status });
      index++;
    }
    return { ...chat, mode: session.mode ?? chat.mode, turns: turns.slice(-6) };
  }
}
