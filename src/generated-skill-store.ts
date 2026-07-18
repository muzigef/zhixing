import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import type { LearningProfile } from "./learning-profile.js";
import { PathPolicy } from "./paths.js";

const skillName = /^[a-z][a-z0-9-]{1,62}$/;

/** Writes reviewable local Skill drafts and exposes them only after activation. */
export class GeneratedSkillStore {
  constructor(private readonly root: string, private readonly paths: PathPolicy) {}

  async createDraft(topicId: TopicId, name: string, profile: LearningProfile): Promise<void> {
    if (!skillName.test(name)) throw new Error("invalid_skill_name: 使用 2–63 位 kebab-case 名称。");
    const file = this.draftFile(topicId, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const goal = inline(profile.goal);
    const level = inline(profile.level);
    const content = `---\nname: ${name}\ndescription: Guide a ${level} learner toward ${goal}. Use for scoped ${topicId} study sessions, practice design, and evidence-based review.\n---\n\n# ${name}\n\n1. Confirm the learner's current Day and available time (${profile.dailyMinutes} minutes).\n2. Use only the active topic plan and explicitly supplied library citations.\n3. Produce one objective, one practice task, one failure case, and one reflection prompt.\n4. Do not edit learning state, import/delete materials, access credentials, or claim completion; ask the learner to submit evidence through the normal Review command.\n`;
    await fs.writeFile(file, content, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code === "EEXIST") throw new Error("skill_draft_exists"); throw error; });
  }

  async listDrafts(topicId: TopicId): Promise<string[]> {
    try { return (await fs.readdir(this.draftDirectory(topicId), { withFileTypes: true })).filter((entry) => entry.isDirectory() && skillName.test(entry.name)).map((entry) => entry.name).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  async readDraft(topicId: TopicId, name: string): Promise<string> { return fs.readFile(this.draftFile(topicId, name), "utf8"); }

  async activate(topicId: TopicId, name: string): Promise<void> {
    if (!skillName.test(name)) throw new Error("invalid_skill_name");
    const source = this.draftFile(topicId, name);
    const destination = path.join(this.root, "skills", topicId, name, "SKILL.md");
    await fs.access(source);
    try { await fs.access(destination); throw new Error("skill_already_active"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  }

  private draftDirectory(topicId: TopicId): string { return this.paths.resolveTopicPath(topicId, "notes", "skill-drafts"); }
  private draftFile(topicId: TopicId, name: string): string { return path.join(this.draftDirectory(topicId), name, "SKILL.md"); }
}

function inline(value: string): string { return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
