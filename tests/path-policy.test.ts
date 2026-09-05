import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("topic path policy", () => {
  it("rejects a symlink in a shared parent of the topic", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-path-parent-")); roots.push(root);
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-path-target-")); roots.push(external);
    await fs.mkdir(path.join(root, "zhixing", "data"), { recursive: true });
    await fs.mkdir(path.join(external, "rag"));
    await fs.symlink(external, path.join(root, "zhixing", "data", "sessions"));
    await expect(new PathPolicy(root).assertNoSymlink("rag", "sessions")).rejects.toThrow("denied");
  });
  it("rejects nested and leaf symlinks before returning an accessible path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-path-leaf-")); roots.push(root);
    const policy = new PathPolicy(root);
    const directory = policy.topicDir("rag", "sessions"); await fs.mkdir(directory, { recursive: true });
    const other = policy.topicDir("other", "sessions"); await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(other, "teaching.json"), "private fixture");
    await fs.symlink(other, path.join(directory, "history"));
    await fs.symlink(path.join(other, "teaching.json"), path.join(directory, "teaching.json"));
    expect(() => policy.resolveTopicPath("rag", "sessions", "history", "teaching.json")).toThrow("denied");
    expect(() => policy.resolveTopicPath("rag", "sessions", "teaching.json")).toThrow("denied");
  });
});
