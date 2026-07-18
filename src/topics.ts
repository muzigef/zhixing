import { type TopicDefinition, topicIdSchema, type TopicId } from "./contracts.js";

/** Registry is the only source of valid topic roots and plans. */
export class TopicRegistry {
  readonly #topics = new Map<TopicId, TopicDefinition>();

  register(topic: TopicDefinition): void {
    const id = topicIdSchema.parse(topic.topicId);
    if (this.#topics.has(id)) throw new Error(`主题已注册: ${id}`);
    this.#topics.set(id, topic);
  }

  get(topicId: string): TopicDefinition {
    const id = topicIdSchema.parse(topicId);
    const topic = this.#topics.get(id);
    if (!topic) throw new Error(`未知主题: ${id}`);
    return topic;
  }

  has(topicId: string): boolean {
    return this.#topics.has(topicIdSchema.parse(topicId));
  }

  list(): readonly TopicDefinition[] {
    return [...this.#topics.values()];
  }
}

/** Creates the product decisions' four initial topics. */
export function createDefaultTopicRegistry(): TopicRegistry {
  const registry = new TopicRegistry();
  registry.register({ topicId: "agent-development", title: "Agent 开发学习", planPath: "topics/agent-development/PLAN.md", skillRoot: "skills/agent-development", prerequisites: [] });
  registry.register({ topicId: "rag", title: "RAG 与 Grounding", planPath: "topics/rag/PLAN.md", skillRoot: "skills/rag", prerequisites: [{ topicId: "agent-development", requiredDays: ["D01", "D02"] }] });
  registry.register({ topicId: "tool-calling", title: "工具调用与安全", planPath: "topics/tool-calling/PLAN.md", skillRoot: "skills/tool-calling", prerequisites: [{ topicId: "agent-development", requiredDays: ["D01"] }] });
  registry.register({ topicId: "interview-project", title: "面试与项目", planPath: "topics/interview-project/PLAN.md", skillRoot: "skills/interview-project", prerequisites: [] });
  return registry;
}
