import path from "node:path";
import fs from "node:fs/promises";
import { topicIdSchema, type TopicId } from "./contracts.js";

/** Resolves only paths under a topic-owned root. */
export class PathPolicy {
  constructor(readonly root: string) {}

  topicDir(topicId: TopicId, area: "library" | "sessions" | "audit" | "notes"): string {
    const id = topicIdSchema.parse(topicId);
    const base = area === "notes" ? path.join(this.root, "learning-notes", "topics") : path.join(this.root, "zhixing", "data", area);
    return path.join(base, id);
  }

  resolveTopicPath(topicId: TopicId, area: "library" | "sessions" | "audit" | "notes", ...parts: string[]): string {
    if (parts.some((part) => part === ".." || part.includes("\\") || path.isAbsolute(part))) throw new Error("denied: 非法路径片段");
    const base = this.topicDir(topicId, area);
    const candidate = path.resolve(base, ...parts);
    if (!candidate.startsWith(`${path.resolve(base)}${path.sep}`) && candidate !== path.resolve(base)) throw new Error("denied: 路径越界");
    return candidate;
  }

  /** Reject pre-existing symbolic links before a controlled store writes beneath them. */
  async assertNoSymlink(topicId: TopicId, area: "library" | "sessions" | "audit" | "notes"): Promise<void> {
    const base = this.topicDir(topicId, area);
    try {
      if ((await fs.lstat(base)).isSymbolicLink()) throw new Error("denied: 符号链接路径");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
