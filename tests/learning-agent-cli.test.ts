import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-agent-cli-")); roots.push(root);
  const settings = path.join(root, "zhixing", "settings"); await fs.mkdir(settings, { recursive: true });
  await fs.writeFile(path.join(settings, "model-routing.local.json"), JSON.stringify({ routes: { tutor: "deepseek-api", reviewer: "mock", lab: "mock" } }));
  const database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  database.addDocument("fixture-doc", "rag", "fixture-hash", "notes.md", "text/markdown", "indexed");
  database.addChunk("fixture-chunk", "rag", "fixture-doc", "RAG fixture evidence for citation.", null, "intro", "chunk-hash");
  database.close();
  const fixture = path.join(root, "provider-fixture.mjs");
  const requestsFile = path.join(root, "requests.json");
  const keychainModule = new URL("../src/macos-keychain.ts", import.meta.url).href;
  await fs.writeFile(fixture, `
import fs from 'node:fs/promises';
import { MacOSKeychainSecretStore } from ${JSON.stringify(keychainModule)};
MacOSKeychainSecretStore.prototype.get = async () => 'fixture-key';
const requests = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body); requests.push(body);
  await fs.writeFile(${JSON.stringify(requestsFile)}, JSON.stringify(requests));
  const message = requests.length === 1
    ? { content: null, tool_calls: [{ id: 'lookup-1', type: 'function', function: { name: 'search_materials', arguments: JSON.stringify({ query: 'RAG' }) } }] }
    : { content: body.messages.at(-1).content.includes('tool_not_allowed') ? 'Material search needs consent.' : 'RAG answer, source notes.md#intro.' };
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] }));
};
`);
  return { root, requestsFile, invoke: (command: string) => exec(process.execPath, ["--import", "tsx", "--import", fixture, "src/cli.ts", command, "--topic", "rag"], { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "1" } }) };
}

describe("learning assistant CLI end to end with no external calls", () => {
  it("retrieves actual fixture evidence, continues and records one run", async () => {
    const fixture = await setup();
    const result = await fixture.invoke("学习助手 解释 RAG --允许外发");
    expect(result.stdout).toContain("RAG answer, source notes.md#intro.");
    const requests = JSON.parse(await fs.readFile(fixture.requestsFile, "utf8"));
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContain("RAG fixture evidence");
    const auditDirectory = path.join(fixture.root, "zhixing", "data", "audit", "rag");
    const content = await fs.readFile(path.join(auditDirectory, (await fs.readdir(auditDirectory))[0]!), "utf8");
    const events = content.trim().split("\n").map((line) => JSON.parse(line));
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(events.filter((event) => event.command === "tool:search_materials").map((event) => event.type)).toEqual(["tool_started", "tool_finished"]);
    expect(content).not.toContain("RAG fixture evidence");
    expect(content).not.toContain("fixture-key");
  });
  it("does not send source text when material consent is absent", async () => {
    const fixture = await setup();
    await expect(fixture.invoke("学习助手 解释 RAG")).resolves.toMatchObject({ stdout: expect.stringContaining("Material search needs consent") });
    const requests = await fs.readFile(fixture.requestsFile, "utf8");
    expect(requests).not.toContain("RAG fixture evidence");
    expect(JSON.parse(requests)[0].tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["learning_progress", "list_materials"]);
  });
  it("uses the same controlled tools from natural conversation without an assistant prefix", async () => {
    const fixture = await setup();
    const result = await fixture.invoke("结合资料解释 RAG --允许外发");
    expect(result.stdout).toContain("RAG answer, source notes.md#intro.");
    const requests = JSON.parse(await fs.readFile(fixture.requestsFile, "utf8"));
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain("search_materials");
    expect(requests[1].messages.at(-1).content).toContain("RAG fixture evidence");
  });
  it("keeps material consent scoped even when tools are available in natural chat", async () => {
    const fixture = await setup();
    await expect(fixture.invoke("结合资料解释 RAG")).resolves.toMatchObject({ stdout: expect.stringContaining("Material search needs consent") });
    const requests = await fs.readFile(fixture.requestsFile, "utf8");
    expect(requests).not.toContain("RAG fixture evidence");
    expect(JSON.parse(requests)[0].tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["learning_progress", "list_materials"]);
  });

});
