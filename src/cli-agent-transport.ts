import { randomUUID } from "node:crypto";
import { PathPolicy } from "./paths.js";
import { AgentService, type AgentInvocation } from "./agent-service.js";
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
    profile: (session: ChatSession, request: SendRequest) => Promise<AgentInvocation>,
    display: (text: string) => void,
  ) {
    let applicationTurn = false;
    this.service = new AgentService(new AgentSessionStore(new PathPolicy(root).resolveWorkspacePath("zhixing", "agent")), client, application, async (session, request) => {
      applicationTurn = request.text.startsWith("/agent ") || Boolean(request.resumeTaskId && session.messages.slice(0, -2).some(message => message.taskId === request.resumeTaskId && message.profile === "application"));
      return applicationTurn ? undefined : profile(session, request);
    });
    this.service.subscribe(event => { if (event.type === "session") this.queued = event.session.pendingRequests?.length ?? 0; if (applicationTurn && event.type === "delta") display(event.text); });
  }
  async recover(chat: ConversationSession): Promise<ConversationSession> {
    try { return await this.projection(chat); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return chat; throw error; }
  }
  async ensure(chat: ConversationSession): Promise<ChatSession> {
    try { return await this.service.load(chat.id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const now = new Date().toISOString();
    const session: ChatSession = { version: 3, id: chat.id, title: chat.goal?.slice(0, 80) || "新对话", customTitle: false, createdAt: now, updatedAt: now, topicId: chat.topicId,
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
  async invoke(chat: ConversationSession, request: Omit<SendRequest, "sessionId">, invocation: AgentInvocation) {
    const session = await this.ensure(chat);
    const previous = session.messages.at(-1);
    const resumeTaskId = this.pendingResume ?? (/^(?:继续|重试|接着)/.test(request.text) && previous?.status !== "completed" ? previous?.taskId : undefined);
    this.pendingResume = undefined;
    const raw = { ...request, sessionId: chat.id, resumeTaskId, steerId: this.pendingSteerId };
    this.pendingSteerId = undefined;
    if (resumeTaskId && session.messages.some(message => message.taskId === resumeTaskId && message.profile === "application")) {
      const cancel = () => this.service.stop();
      invocation.signal?.throwIfAborted();
      invocation.signal?.addEventListener("abort", cancel, { once: true });
      try {
        await this.service.send(raw); await this.service.idle();
        const message = (await this.service.load(chat.id)).messages.at(-1)!;
        if (invocation.signal?.aborted || message.status === "interrupted") throw new DOMException("cancelled", "AbortError");
        return { text: message.text, finalText: message.text, events: 0, toolResults: [], providerId: message.provider ?? raw.provider, waiting: message.status === "waiting", blocked: message.status === "blocked", ...(message.status === "failed" ? { partial: true, stopReason: "provider_incomplete" } : {}) };
      } finally { invocation.signal?.removeEventListener("abort", cancel); }
    }
    return this.service.invoke(raw, invocation);
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
    return { ...chat, turns: turns.slice(-6) };
  }
}
