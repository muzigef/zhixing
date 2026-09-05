import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { LearningRuntime } from "../src/runtime.js";
import { PathPolicy } from "../src/paths.js";
import { createDefaultTopicRegistry } from "../src/topics.js";

const roots: string[] = [];
const applications: LearningApplication[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-application-")); roots.push(root);
  const app = await LearningApplication.open(root, process.cwd()); applications.push(app);
  return { root, app };
}
afterEach(async () => {
  for (const app of applications.splice(0)) app.close();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("shared learning application", () => {
  it("shows the same course and progress to desktop and CLI without copying user history", async () => {
    const { root, app } = await fixture();
    const overview = await app.overview("agent-development");
    expect(overview.course[0]).toMatchObject({ id: "D01", title: "Agent 契约与状态边界" });
    await app.handle("开始第 1 天", "agent-development");
    const cli = new LearningRuntime(createDefaultTopicRegistry(), new PathPolicy(root));
    expect(await cli.handle("进度", "agent-development")).toBe((await app.overview("agent-development")).progress);
    const reopened = await LearningApplication.open(root); applications.push(reopened);
    expect((await reopened.overview("agent-development")).days[0]).toMatchObject({ dayId: "D01", state: "进行中" });
  });
  it("imports a user-selected document, exposes a verified source, and denies cross-topic references", async () => {
    const { root, app } = await fixture();
    const source = path.join(root, "selected.md");
    await fs.writeFile(source, "# 检索依据\n\n检索结果必须关联原文出处。");
    expect(await app.importSelected("rag", source, new AbortController().signal)).toMatchObject({ status: "indexed" });
    const context = await app.context("rag", "检索", true, new AbortController().signal);
    expect(context.evidence[0]?.citation.documentName).toBe("selected.md");
    expect((await app.source("rag", context.evidence[0]!.citation)).text).toContain("关联原文出处");
    await expect(app.source("tool-calling", context.evidence[0]!.citation)).rejects.toThrow("cross_topic_denied");
    const denied = await app.context("rag", "检索", false, new AbortController().signal);
    expect(denied.evidence).toEqual([]);
    expect(denied.text).not.toContain("关联原文出处");
    await expect(app.importSelected("rag", path.join(root, "secret.json"), new AbortController().signal)).rejects.toThrow();
  });
  it("does not overwrite a course already present in a connected workspace", async () => {
    const { root, app } = await fixture();
    const file = path.join(root, "zhixing/topics/agent-development/PLAN.md");
    const original = await fs.readFile(file, "utf8");
    await fs.writeFile(file, original.replace("Agent 契约与状态边界", "我的课程"));
    const reopened = await LearningApplication.open(root, process.cwd()); applications.push(reopened);
    expect((await reopened.overview("agent-development")).course[0]?.title).toBe("我的课程");
    await expect(app.overview("../../outside")).rejects.toThrow();
  });
  it("locates the exact retrieved chunk deep inside a long section and deduplicates concurrent imports", async () => {
    const { root, app } = await fixture();
    const file = path.join(root, "long.md");
    await fs.writeFile(file, `# 一个长章节\n\n${"早期内容。".repeat(4000)}\n准确命中：后半段独有的验证标记。`);
    const imported = await Promise.all([app.importSelected("rag", file, new AbortController().signal), app.importSelected("rag", file, new AbortController().signal)]);
    expect(imported.map((item) => item.status).sort()).toEqual(["duplicate", "indexed"]);
    const result = app.library.search("rag", "验证标记").find((item) => item.text.includes("验证标记"))!;
    expect(result.citation.chunkId).toBeDefined();
    expect((await app.source("rag", result.citation)).text).toBe(result.text);
  });
});
