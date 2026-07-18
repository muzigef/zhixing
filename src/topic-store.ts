import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { topicIdSchema, type TopicDefinition, type TopicId } from "./contracts.js";
import { TopicRegistry } from "./topics.js";

const storedTopicSchema = z.object({ topicId: topicIdSchema, title: z.string().trim().min(1).max(120) });
const storedTopicsSchema = z.array(storedTopicSchema);

/** Persists user-created topic metadata locally and initializes only allowlisted topic roots. */
export class TopicStore {
  constructor(private readonly root: string) {}

  async load(registry: TopicRegistry): Promise<void> {
    try {
      const topics = storedTopicsSchema.parse(JSON.parse(await fs.readFile(this.file(), "utf8")));
      for (const topic of topics) registry.register(definition(topic.topicId, topic.title));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async create(registry: TopicRegistry, topicId: string, title: string): Promise<TopicDefinition> {
    const id = topicIdSchema.parse(topicId);
    const normalizedTitle = z.string().trim().min(1).max(120).parse(title);
    if (registry.has(id)) throw new Error(`主题已注册: ${id}`);
    const topic = definition(id, normalizedTitle);
    const topics = await this.read();
    if (topics.some((item) => item.topicId === id)) throw new Error(`主题已注册: ${id}`);
    await Promise.all([
      fs.mkdir(path.join(this.root, "zhixing", "topics", id), { recursive: true }),
      fs.mkdir(path.join(this.root, "zhixing", "skills", id), { recursive: true }),
      fs.mkdir(path.join(this.root, "zhixing", "inbox", id), { recursive: true }),
    ]);
    await fs.writeFile(path.join(this.root, "zhixing", topic.planPath), starterPlan(id, normalizedTitle), { encoding: "utf8", flag: "wx" });
    await this.write([...topics, { topicId: id, title: normalizedTitle }]);
    registry.register(topic);
    return topic;
  }

  private file(): string { return path.join(this.root, "zhixing", "settings", "topics.local.json"); }

  private async read(): Promise<Array<{ topicId: TopicId; title: string }>> {
    try { return storedTopicsSchema.parse(JSON.parse(await fs.readFile(this.file(), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async write(topics: readonly { topicId: TopicId; title: string }[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file()), { recursive: true });
    const temporary = `${this.file()}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(topics, null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.file());
  }
}

function definition(topicId: TopicId, title: string): TopicDefinition {
  return { topicId, title, planPath: `topics/${topicId}/PLAN.md`, skillRoot: `skills/${topicId}`, prerequisites: [] };
}

function starterPlan(topicId: TopicId, title: string): string {
  return `---\ntopicId: ${topicId}\ntitle: ${title}\nversion: 1\nprerequisites: []\ndays:\n  - id: D01\n    title: 明确目标与建立资料基础\n    estimatedMinutes: 60\n    requiredEvidence: [implementation, test-output, failure-case, reflection]\n    optional: false\n---\n\n# ${title}\n\n这是自动创建的主题计划。设置学习画像后，使用“生成定制课程”创建适合你的课程草案。\n`;
}
