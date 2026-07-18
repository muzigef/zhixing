import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TopicStore } from "../src/topic-store.js";
import { createDefaultTopicRegistry } from "../src/topics.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("dynamic topic store", () => {
  it("creates a local topic with a safe plan and reloads it into the registry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-topic-"));
    roots.push(root);
    const store = new TopicStore(root);
    const registry = createDefaultTopicRegistry();
    await store.create(registry, "3dgs", "3D Gaussian Splatting");
    expect(registry.get("3dgs")).toMatchObject({ title: "3D Gaussian Splatting", planPath: "topics/3dgs/PLAN.md" });
    await expect(fs.readFile(path.join(root, "zhixing", "topics", "3dgs", "PLAN.md"), "utf8")).resolves.toContain("topicId: 3dgs");
    await expect(fs.access(path.join(root, "zhixing", "inbox", "3dgs"))).resolves.toBeUndefined();
    const restored = createDefaultTopicRegistry();
    await store.load(restored);
    expect(restored.get("3dgs").title).toBe("3D Gaussian Splatting");
  });

  it("rejects duplicate topics before changing the local registry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-topic-"));
    roots.push(root);
    const store = new TopicStore(root);
    const registry = createDefaultTopicRegistry();
    await expect(store.create(registry, "rag", "重复主题")).rejects.toThrow("主题已注册");
  });
});
