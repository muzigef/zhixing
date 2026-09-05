import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelClient } from "../src/model.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { desktopCommandSchema } from "../desktop/core/contracts.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function fixture(client: ModelClient) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-desktop-"));
  roots.push(root);
  const store = new DesktopStore(root);
  const service = new DesktopService(store, () => client);
  const session = await service.create();
  return { root, store, service, session };
}
const complete: ModelClient = {
  async *stream() {
    yield { type: "text_delta", text: "这是 **完整回答**。" };
    yield { type: "done" };
  },
};

describe("desktop conversation runtime", () => {
  it("streams and persists complete conversation history beyond the model context window", async () => {
    const { service, store, session } = await fixture(complete);
    const updates: string[] = [];
    service.subscribe((event) => {
      if (event.type === "delta") updates.push(event.text);
    });
    for (let index = 0; index < 8; index++) {
      await service.send({
        sessionId: session.id,
        text: `问题 ${index}`,
        provider: "demo",
        style: "adaptive",
      });
      await service.idle();
    }
    const saved = await store.load(session.id);
    expect(saved.messages).toHaveLength(16);
    expect(saved.messages[0]?.text).toBe("问题 0");
    expect(saved.messages.at(-1)?.status).toBe("completed");
    expect(updates).toHaveLength(8);
    expect((await store.list())[0]?.title).toBe("问题 0");
  });
  it("cancels a live answer, retains partial text, rejects overlap and permits a later turn", async () => {
    const client: ModelClient = {
      async *stream(_prompt, signal) {
        yield { type: "text_delta", text: "部分回答" };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new DOMException("cancelled", "AbortError");
      },
    };
    const { service, store, session } = await fixture(client);
    let first!: () => void;
    const started = new Promise<void>((resolve) => {
      first = resolve;
    });
    service.subscribe((event) => {
      if (event.type === "delta") first();
    });
    await service.send({
      sessionId: session.id,
      text: "解释梯度",
      provider: "demo",
      style: "adaptive",
    });
    await started;
    await expect(
      service.send({
        sessionId: session.id,
        text: "重复",
        provider: "demo",
        style: "adaptive",
      }),
    ).rejects.toThrow("run_active");
    service.stop();
    await service.idle();
    const saved = await store.load(session.id);
    expect(saved.messages.at(-1)).toMatchObject({
      text: "部分回答",
      status: "interrupted",
    });
    expect(service.activeSessionId).toBeNull();
  });
  it("does not turn a missing completion or provider failure into a successful response", async () => {
    const { service, store, session } = await fixture({
      async *stream() {
        yield { type: "text_delta", text: "尚未完成" };
      },
    });
    await service.send({
      sessionId: session.id,
      text: "继续",
      provider: "demo",
      style: "adaptive",
    });
    await service.idle();
    expect((await store.load(session.id)).messages.at(-1)).toMatchObject({
      status: "failed",
      error: "回答未完整返回，请重试。",
    });
  });
  it("isolates session context and limits what is sent to the model without deleting history", async () => {
    const prompts: string[] = [];
    const { service, session } = await fixture({
      async *stream(prompt) {
        prompts.push(prompt);
        yield { type: "text_delta", text: "答" };
        yield { type: "done" };
      },
    });
    await service.send({
      sessionId: session.id,
      text: "第一会话独有信息",
      provider: "demo",
      style: "adaptive",
    });
    await service.idle();
    const second = await service.create();
    await service.send({
      sessionId: second.id,
      text: "第二会话请求",
      provider: "demo",
      style: "concise",
    });
    await service.idle();
    expect(prompts[1]).toContain("第二会话请求");
    expect(prompts[1]).not.toContain("第一会话独有信息");
  });
  it("recovers interrupted answers after restart and rejects traversal / oversized commands", async () => {
    const { store, session } = await fixture(complete);
    session.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      text: "之前的片段",
      status: "running",
      createdAt: new Date().toISOString(),
    });
    await store.save(session);
    expect((await store.load(session.id)).messages[0]?.status).toBe(
      "interrupted",
    );
    await expect(store.load("../../outside")).rejects.toThrow();
    expect(
      desktopCommandSchema.safeParse({
        type: "send",
        sessionId: session.id,
        text: "x".repeat(20_001),
        provider: "demo",
        style: "adaptive",
      }).success,
    ).toBe(false);
    expect(
      desktopCommandSchema.safeParse({
        type: "send",
        sessionId: session.id,
        text: "hello",
        provider: "arbitrary",
        style: "adaptive",
      }).success,
    ).toBe(false);
  });
  it("keeps a custom title, exports readable Markdown and hides unknown error details", async () => {
    const { service, store, session } = await fixture({
      async *stream() {
        throw new Error("private network diagnostic");
        yield { type: "done" };
      },
    });
    await service.rename(session.id, "我的学习记录");
    await service.send({
      sessionId: session.id,
      text: "一个问题",
      provider: "demo",
      style: "adaptive",
    });
    await service.idle();
    const saved = await store.load(session.id);
    expect(saved.title).toBe("我的学习记录");
    expect(saved.messages.at(-1)?.error).not.toContain("private network");
    expect(await service.exportMarkdown(session.id)).toContain(
      "# 我的学习记录",
    );
    expect(await service.exportMarkdown(session.id)).toContain("一个问题");
  });
});
