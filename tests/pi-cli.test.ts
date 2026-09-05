import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function setup(mode = "normal") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-cli-")); roots.push(root);
  const bin = path.join(root, "bin"); const agent = path.join(root, "pi");
  await fs.mkdir(bin); await fs.mkdir(agent);
  await fs.writeFile(path.join(agent, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "fixture-codex", defaultThinkingLevel: "low" }));
  const requests = path.join(root, "requests.json");
  await fs.writeFile(path.join(bin, "pi"), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2); let input = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  let requests = []; try { requests = JSON.parse(fs.readFileSync(${JSON.stringify(requests)}, 'utf8')); } catch {}
  requests.push({argv, input}); fs.writeFileSync(${JSON.stringify(requests)}, JSON.stringify(requests));
  const text = process.env.FIXTURE_PI_MODE === 'stall' && requests.length === 1 ? '这是没有换行的部分解释' : 'Pi 模型回答：查询向量表示当前想找的信息。';
  const emit = event => process.stdout.write(JSON.stringify(event) + '\\n');
  emit({type:'message_update', assistantMessageEvent:{type:'text_delta',delta:text}});
  if (process.env.FIXTURE_PI_MODE === 'stall' && requests.length === 1) { setInterval(() => {}, 1000); return; }
  process.stderr.write('fixture-private-error-detail');
  emit({type:'message_end', message:{role:'assistant',provider:'openai-codex',model:'fixture-codex',content:[{type:'text',text}],stopReason:process.env.FIXTURE_PI_MODE === 'error' ? 'error' : 'stop', errorMessage:'fixture-private-error-detail'}});
  process.stdout.write(JSON.stringify({type:'agent_end', messages:[]}));
});
`, { mode: 0o755 });
  const env = { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "1", PI_CODING_AGENT_DIR: agent, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FIXTURE_PI_MODE: mode, NO_COLOR: "1" };
  const args = ["--import", "tsx", "src/cli.ts"];
  return { root, env, args, requests: async () => JSON.parse(await fs.readFile(requests, "utf8")) as Array<{ argv: string[]; input: string }>, invoke: (command: string) => exec(process.execPath, [...args, command], { cwd: process.cwd(), env }) };
}
describe("Pi provider through the actual safe launcher and CLI", () => {
  it("requires confirmation, persists the route and sends a natural question using Pi preferences", async () => {
    const fixture = await setup();
    expect((await fixture.invoke("模型切换 tutor pi-codex")).stdout).toContain("确认");
    expect((await fixture.invoke("模型切换 tutor pi-codex --确认")).stdout).toContain("tutor -> pi-codex");
    const result = await fixture.invoke("解释查询向量");
    expect(result.stdout.trim()).toBe("Pi 模型回答：查询向量表示当前想找的信息。");
    expect(result.stderr).not.toContain("fixture-private-error-detail");
    const [request] = await fixture.requests();
    expect(request?.argv).toEqual(expect.arrayContaining(["--approve", "--no-extensions", "-e", "./.pi/extensions/zhixing-guard.ts", "--no-session", "--provider", "openai-codex", "--model", "fixture-codex", "--thinking", "low"]));
    expect(request?.argv[(request?.argv.lastIndexOf("--tools") ?? -1) + 1]).toBe("");
    expect(request?.input).toContain("解释查询向量");
    const routes = JSON.parse(await fs.readFile(path.join(fixture.root, "zhixing", "settings", "model-routing.local.json"), "utf8"));
    expect(routes.routes).toEqual({ tutor: "pi-codex", reviewer: "mock", lab: "mock" });
  });
  it("marks zero-exit provider failures incomplete and never exposes Pi error payloads", async () => {
    const fixture = await setup("error"); await fixture.invoke("模型切换 tutor pi-codex --确认");
    const result: unknown = await fixture.invoke("解释查询向量").catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("本轮未完成") });
    expect(result).toMatchObject({ stderr: expect.not.stringContaining("fixture-private-error-detail") });
  });
  it("cancels a stalled Pi process and answers another turn in the same REPL", async () => {
    const fixture = await setup("stall"); await fixture.invoke("模型切换 tutor pi-codex --确认");
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...fixture.args, "--repl"], { cwd: process.cwd(), env: fixture.env });
      let output = ""; let sent = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error("fixture_pi_cancel_timeout")); }, 8_000);
      child.stdout.on("data", (chunk) => { output += chunk.toString(); if (!sent && output.includes("没有换行的部分解释")) { sent = true; child.stdin.end("停止\n换个例子\n/exit\n"); } });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); if (code) reject(new Error(output)); else resolve(output); });
      child.stdin.write("解释查询向量\n");
    });
    expect(output).toContain("已停止本轮回答");
    expect(output).toContain("Pi 模型回答");
    const requests = await fixture.requests(); expect(requests).toHaveLength(2);
    expect(requests[1]!.input).toContain("没有换行的部分解释");
  });
});
