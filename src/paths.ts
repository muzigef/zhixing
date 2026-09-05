import path from "node:path";
import { lstatSync } from "node:fs";
import { topicIdSchema, type TopicId } from "./contracts.js";

/** Resolves only paths under a topic-owned root. */
export class PathPolicy {
  constructor(readonly root: string) {}

  resolveWorkspacePath(...parts: string[]): string {
    if (parts.some((part) => path.isAbsolute(part) || part.includes("\\") || part.split("/").includes(".."))) throw new Error("denied: 非法工作区路径");
    const candidate = path.resolve(this.root, ...parts);
    if (candidate !== path.resolve(this.root) && !candidate.startsWith(`${path.resolve(this.root)}${path.sep}`)) throw new Error("denied: 路径越界");
    this.assertPath(candidate);
    return candidate;
  }

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
    this.assertPath(candidate);
    return candidate;
  }

  /** Reject pre-existing symbolic links before a controlled store writes beneath them. */
  async assertNoSymlink(topicId: TopicId, area: "library" | "sessions" | "audit" | "notes"): Promise<void> {
    this.assertPath(path.resolve(this.topicDir(topicId, area)));
  }

  private assertPath(candidate: string): void {
    // The configured root is the trust anchor. Check every component beneath
    // it, including shared parents and the leaf, before returning a usable path.
    // This rejects existing links; it is not an OS sandbox against concurrent renames.
    let current = path.resolve(this.root);
    for (const part of path.relative(current, candidate).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error("denied: 符号链接路径");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
  }
}
