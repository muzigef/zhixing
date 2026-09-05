import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import type { TopicDefinition } from "./contracts.js";
import { PathPolicy } from "./paths.js";
import { topicPlanSchema, type TopicPlan } from "./plan-schema.js";

export type EvidenceRequirement = "implementation" | "testOutput" | "failureCase" | "reflection";
export interface TopicPlanDay { readonly id: string; readonly title: string; readonly estimatedMinutes: number; readonly requiredEvidence: readonly EvidenceRequirement[]; readonly optional: boolean; }
const DEFAULT_REQUIREMENTS: readonly EvidenceRequirement[] = ["implementation", "testOutput", "failureCase", "reflection"];
const EVIDENCE_MAP: Record<string, EvidenceRequirement> = {
  implementation: "implementation",
  "test-output": "testOutput",
  "failure-case": "failureCase",
  reflection: "reflection",
};

/** Validates complete plans; only plans without a days block use the legacy fallback. */
export class TopicPlanLoader {
  constructor(private readonly root: string) {}

  private async frontmatter(topic: TopicDefinition): Promise<Record<string, unknown> | undefined> {
    const file = new PathPolicy(this.root).resolveWorkspacePath("zhixing", topic.planPath);
    let content: string;
    try {
      if ((await fs.stat(file)).size > 512_000) throw new Error("topic_plan_invalid");
      content = await fs.readFile(file, "utf8");
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
    if (!frontmatter) return undefined;
    try {
      const parsed = parseDocument(frontmatter, { uniqueKeys: true });
      if (parsed.errors.length) throw new Error("topic_plan_invalid");
      const value: unknown = parsed.toJS({ maxAliasCount: 0 });
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("topic_plan_invalid");
      return value as Record<string, unknown>;
    } catch { throw new Error("topic_plan_invalid"); }
  }

  async load(topic: TopicDefinition): Promise<TopicPlan | undefined> {
    const value = await this.frontmatter(topic);
    if (!value || !("days" in value)) return undefined;
    const parsed = topicPlanSchema.safeParse(value);
    if (!parsed.success || parsed.data.topicId !== topic.topicId) throw new Error("topic_plan_invalid");
    return parsed.data;
  }

  async days(topic: TopicDefinition): Promise<readonly TopicPlanDay[]> {
    return (await this.load(topic))?.days.map((day) => ({ ...day, requiredEvidence: day.requiredEvidence.map((item) => EVIDENCE_MAP[item]!) })) ?? [];
  }

  async requiredEvidence(topic: TopicDefinition): Promise<readonly EvidenceRequirement[]> {
    const value = await this.frontmatter(topic);
    if (value && "days" in value) await this.load(topic);
    const values = Array.isArray(value?.requiredEvidence) ? value.requiredEvidence : [];
    const requirements = values.map((item: unknown) => typeof item === "string" ? EVIDENCE_MAP[item] : undefined).filter((item): item is EvidenceRequirement => item !== undefined);
    return requirements.length ? requirements : DEFAULT_REQUIREMENTS;
  }

  async day(topic: TopicDefinition, dayId: string): Promise<TopicPlanDay | undefined> {
    return (await this.days(topic)).find((day) => day.id === dayId);
  }
}
