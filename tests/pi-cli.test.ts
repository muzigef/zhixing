import { pathToFileURL } from "node:url";
import { resolvePiSdk } from "../src/pi-sdk.js";
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
  const sdk = path.join(root, "sdk.mjs");
  await fs.writeFile(sdk, `import fs from 'node:fs';
export class ModelRuntime {
  static async create(){return new ModelRuntime();}
  getModel(){return {provider:'openai-codex',id:'fixture-codex',api:'openai-codex-responses',contextWindow:48000,maxTokens:16384,reasoning:true,input:['text','image']};}
  hasConfiguredAuth(){return true;}
  async *streamSimple(model, context, options){
    let requests=[]; try {requests=JSON.parse(fs.readFileSync(${JSON.stringify(requests)},'utf8'));} catch {}
    requests.push({input:JSON.stringify(context),options:{reasoning:options.reasoning,maxTokens:options.maxTokens,transport:options.transport},tools:context.tools?.map(tool=>tool.name)});
    fs.writeFileSync(${JSON.stringify(requests)},JSON.stringify(requests));
    const text=process.env.FIXTURE_PI_MODE==='stall'&&requests.length===1?'这是没有换行的部分解释':'Pi 模型回答：查询向量表示当前想找的信息。';
    yield {type:'text_delta',delta:text};
    if(process.env.FIXTURE_PI_MODE==='stall'&&requests.length===1){setInterval(()=>{},1000);await new Promise(()=>{});}
    if(process.env.FIXTURE_PI_MODE==='error') throw Error('fixture-private-error-detail');
    yield {type:'done',reason:'stop',message:{role:'assistant',provider:model.provider,model:model.id,content:[{type:'text',text}],usage:{input:1,output:1,cacheRead:0,cacheWrite:0}}};
  }
}`);
  const hook = path.join(root, "module-hook.mjs");
  await fs.writeFile(hook, `import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return specifier===${JSON.stringify(pathToFileURL(await resolvePiSdk(process.cwd())).href)}?{url:${JSON.stringify(pathToFileURL(sdk).href)},shortCircuit:true}:next(specifier,context);}});`);
  const env = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(hook).href}`, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "1", PI_CODING_AGENT_DIR: agent, FIXTURE_PI_MODE: mode, NO_COLOR: "1" };
  const args = ["--import", "tsx", "src/cli.ts"];
  return { root, env, args, requests: async () => JSON.parse(await fs.readFile(requests, "utf8")) as Array<{ input: string; options: { reasoning: string; maxTokens: number; transport: string }; tools: string[] }>, invoke: (command: string) => exec(process.execPath, [...args, command], { cwd: process.cwd(), env, timeout: 4_000 }) };
}
describe("Pi provider through the shared model worker and actual CLI", () => {
  it("carries an explicitly attached CLI image through the shared service, durable checkpoint and SDK worker", async () => {
    const fixture = await setup(); await fixture.invoke("模型切换 tutor pi-codex --确认");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=";
    const file = path.join(fixture.root, "synthetic.png"); await fs.writeFile(file, Buffer.from(png, "base64"));
    expect((await fixture.invoke(`/image "${file}" 描述图片`)).stdout).toContain("Pi 模型回答");
    expect((await fixture.requests())[0]?.input).toContain('"type":"image"');
    await fixture.invoke("继续解释图片");
    expect((await fixture.requests())[1]?.input).toContain(png);
  }, 15_000);
  it("requires confirmation, persists the route and sends a natural question using Pi preferences", async () => {
    const fixture = await setup();
    expect((await fixture.invoke("模型切换 tutor pi-codex")).stdout).toContain("确认");
    expect((await fixture.invoke("模型切换 tutor pi-codex --确认")).stdout).toContain("tutor -> pi-codex");
    const result = await fixture.invoke("解释查询向量");
    expect(result.stdout.trim()).toBe("Pi 模型回答：查询向量表示当前想找的信息。");
    expect(result.stderr).not.toContain("fixture-private-error-detail");
    const [request] = await fixture.requests();
    expect(request?.options).toMatchObject({ reasoning: "low", maxTokens: 16384, transport: "sse" });
    expect(request?.tools).toEqual(["ask_user", "read_execution_history"]);
    expect(request?.input).toContain("解释查询向量");
    const routes = JSON.parse(await fs.readFile(path.join(fixture.root, "zhixing", "settings", "model-routing.local.json"), "utf8"));
    expect(routes.routes).toEqual({ tutor: "pi-codex", reviewer: "mock", lab: "mock" });
  }, 15_000); // Three real CLI processes, each bounded to 4s, plus filesystem setup under suite load.
  it("marks zero-exit provider failures incomplete and never exposes Pi error payloads", async () => {
    const fixture = await setup("error"); await fixture.invoke("模型切换 tutor pi-codex --确认");
    const result: unknown = await fixture.invoke("解释查询向量").catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("本轮未完成") });
    expect(result).toMatchObject({ stderr: expect.not.stringContaining("fixture-private-error-detail") });
  }, 10_000);
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
  }, 14_000); // 4s setup command + the existing 8s REPL cancellation deadline.
});
