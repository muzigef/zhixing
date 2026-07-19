import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { LearningContextBuilder } from "../src/learning-context.js";
import { LearningProfileStore } from "../src/learning-profile.js";
import { PathPolicy } from "../src/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("learning context builder", () => {
  it("only recalls the active topic's profile and memories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-context-")); roots.push(root);
    const policy = new PathPolicy(root); const database = new ZhixingDatabase(path.join(root, "db.sqlite"));
    const profiles = new LearningProfileStore(policy); await profiles.save("rag", { goal: "掌握 RAG", level: "初学", dailyMinutes: 45, totalDays: 14 });
    database.writeMemory("rag-memory", { topicId: "rag", type: "learning_fact", content: "RAG 必须保留引用", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
    database.writeMemory("other-memory", { topicId: "3dgs", type: "learning_fact", content: "不得泄露", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
    const context = await new LearningContextBuilder(profiles, database, new DocumentLibrary(database, policy)).build("rag", "RAG 引用");
    expect(context).toContain("掌握 RAG"); expect(context).toContain("RAG 必须保留引用"); expect(context).not.toContain("不得泄露");
    database.close();
  });
});
