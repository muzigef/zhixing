import fs from "node:fs/promises";
import path from "node:path";
import type { TopicDefinition } from "./contracts.js";

export type EvidenceRequirement = "implementation" | "testOutput" | "failureCase" | "reflection";
export interface TopicPlanDay { readonly id: string; readonly title: string; readonly estimatedMinutes: number; readonly requiredEvidence: readonly EvidenceRequirement[]; readonly optional: boolean; }
const DEFAULT_REQUIREMENTS: readonly EvidenceRequirement[] = ["implementation", "testOutput", "failureCase", "reflection"];
const EVIDENCE_MAP: Record<string, EvidenceRequirement> = {
  implementation: "implementation",
  "test-output": "testOutput",
  "failure-case": "failureCase",
  reflection: "reflection",
};

/** Reads minimal Topic Plan frontmatter and safely falls back for legacy plans. */
export class TopicPlanLoader {
  constructor(private readonly root: string) {}

  async requiredEvidence(topic: TopicDefinition): Promise<readonly EvidenceRequirement[]> {
    const file = path.resolve(this.root, "zhixing", topic.planPath);
    let content: string;
    try { content = await fs.readFile(file, "utf8"); } catch { return DEFAULT_REQUIREMENTS; }
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
    const values = /requiredEvidence:\s*\[([^\]]*)\]/.exec(frontmatter ?? "")?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    const requirements = values.map((value) => EVIDENCE_MAP[value]).filter((value): value is EvidenceRequirement => value !== undefined);
    return requirements.length ? requirements : DEFAULT_REQUIREMENTS;
  }

  async day(topic: TopicDefinition, dayId: string): Promise<TopicPlanDay | undefined> {
    const file = path.resolve(this.root, "zhixing", topic.planPath);
    let content: string;
    try { content = await fs.readFile(file, "utf8"); } catch { return undefined; }
    const daysStart = content.indexOf("days:\n");
    const section = daysStart >= 0 ? content.slice(daysStart + "days:\n".length, content.indexOf("\n---", daysStart)) : "";
    for (const entry of section.split(/^\s*-\s+id:\s*/m).slice(1)) {
      const [id, ...bodyLines] = entry.split("\n");
      if (id?.trim() !== dayId) continue;
      const body = bodyLines.join("\n");
      const title = /^\s+title:\s*(.+)$/m.exec(body)?.[1]?.trim();
      const estimatedMinutes = Number(/^\s+estimatedMinutes:\s*(\d+)\s*$/m.exec(body)?.[1]);
      const values = /^\s+requiredEvidence:\s*\[([^\]]*)\]/m.exec(body)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
      const requiredEvidence = values.map((value) => EVIDENCE_MAP[value]).filter((value): value is EvidenceRequirement => value !== undefined);
      const optional = /^\s+optional:\s*true\s*$/m.test(body);
      if (title && Number.isInteger(estimatedMinutes) && estimatedMinutes > 0 && requiredEvidence.length) return { id: dayId, title, estimatedMinutes, requiredEvidence, optional };
    }
    return undefined;
  }
}
