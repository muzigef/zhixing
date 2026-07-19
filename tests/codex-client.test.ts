import { describe, expect, it } from "vitest";
import { CodexCliClient, codexJsonText } from "../src/codex-client.js";

async function collect(client: CodexCliClient): Promise<string[]> {
  const controller = new AbortController();
  const events: string[] = [];
  for await (const event of client.stream("hello", controller.signal)) events.push(event.type === "text_delta" ? event.text ?? "" : event.type);
  return events;
}

describe("Codex CLI adapter", () => {
  it("extracts incremental assistant text from codex JSONL without rendering lifecycle events", () => {
    expect(codexJsonText('{"type":"item.agent_message.delta","delta":"你好"}')).toBe("你好");
    expect(codexJsonText('{"type":"item.completed","item":{"type":"agent_message","text":"完整回答"}}')).toBe("完整回答");
    expect(codexJsonText('{"type":"thread.started"}')).toBeUndefined();
  });
  it("默认允许真实 Provider", async () => {
    const client = new CodexCliClient(async () => ({ code: 0, stdout: "never", stderr: "" }), {});
    await expect(collect(client)).resolves.toEqual(["never", "done"]);
  });

  it("只使用官方 CLI 的只读、临时 argv 并支持 mock 响应", async () => {
    let received: readonly string[] = [];
    const client = new CodexCliClient(async (args) => {
      received = args;
      return { code: 0, stdout: "model reply", stderr: "" };
    }, { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    await expect(collect(client)).resolves.toEqual(["model reply", "done"]);
    expect(received).toEqual(expect.arrayContaining(["exec", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config"]));
    expect(received).not.toContain("--ignore-rules");
    expect(received).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("将 CLI 失败标准化为 provider_unavailable", async () => {
    const client = new CodexCliClient(async () => ({ code: 1, stdout: "", stderr: "not logged in" }), { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    await expect(collect(client)).rejects.toThrow("provider_unavailable");
  });

  it("超时时中止官方 CLI 并返回结构化错误", async () => {
    const client = new CodexCliClient(async (_args, signal) => await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })), { ZHIXING_ALLOW_LIVE_PROVIDER: "1" }, 1);
    await expect(collect(client)).rejects.toThrow("provider_timeout");
  });

});
