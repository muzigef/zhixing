import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentSessionStore } from "../src/agent-session-store.js";
const exec = promisify(execFile);
it("resumes a CLI question after process restart through the shared native tool journal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-journal-"));
  try {
    await fs.mkdir(path.join(root, "zhixing/settings"), { recursive: true });
    await fs.writeFile(path.join(root, "zhixing/settings/model-routing.local.json"), JSON.stringify({ routes: { tutor: "deepseek-api", reviewer: "mock", lab: "mock" } }));
    const preload = path.join(root, "provider.mjs"); const requests = path.join(root, "requests.json");
    await fs.writeFile(preload, `import fs from 'node:fs/promises';
import { MacOSKeychainSecretStore } from ${JSON.stringify(new URL("../src/macos-keychain.ts", import.meta.url).href)};
MacOSKeychainSecretStore.prototype.get = async () => 'fixture-value';
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body); let history = []; try { history = JSON.parse(await fs.readFile(${JSON.stringify(requests)}, 'utf8')); } catch {}
  history.push(body); await fs.writeFile(${JSON.stringify(requests)}, JSON.stringify(history));
  const answered = body.messages.some(message => message.role === 'tool');
  const message = answered ? {content:'使用数组说明。'} : {content:null, tool_calls:[{id:'ask-one',type:'function',function:{name:'ask_user',arguments:JSON.stringify({title:'使用哪种例子？',options:['数组','链表']})}}]};
  return new Response(JSON.stringify({choices:[{message,finish_reason:answered?'stop':'tool_calls'}]}));
};`);
    const invoke = (command: string) => exec(process.execPath, ["--import", "tsx", "--import", preload, "src/cli.ts", command], { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "1" } });
    const first = await invoke("/agent 解释算法"); const id = /\/answer ([0-9a-f-]{36})/.exec(first.stdout)?.[1]; expect(id).toBeTruthy();
    expect((await invoke(`/answer ${id} 数组`)).stdout).toContain("使用数组说明");
    const wire = JSON.parse(await fs.readFile(requests, "utf8")); expect(wire).toHaveLength(2);
    expect(wire[1].messages.find((message: {role: string}) => message.role === "tool")).toMatchObject({ tool_call_id: "ask-one", content: expect.stringContaining("数组") });
    const store = new AgentSessionStore(path.join(root, "zhixing/agent")); const summary = (await store.list())[0]!; const session = await store.load(summary.id);
    expect(session.messages[1]?.taskId).toBe(session.messages[3]?.taskId); expect(session.messages.at(-1)?.status).toBe("completed");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
