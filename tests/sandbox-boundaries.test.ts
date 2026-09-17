import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { LocalSandbox } from "../src/local-sandbox.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const execute = (code: string, policy: Record<string, unknown> = {}) => new LocalSandbox().run(process.execPath, ["-e", code], { allowedCommands: [process.execPath], policy });

it("actually denies outside reads/writes, symlink escapes, network and subprocesses while allowing task files", async () => {
  vi.stubEnv("ZHIXING_SANDBOX_SYNTHETIC", "must-not-be-inherited");
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-boundary-")));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const secret = path.join(root, "synthetic.txt"), outside = path.join(root, "escaped.txt");
  await fs.writeFile(secret, "synthetic fixture, not user data");
  const listener = net.createServer(socket => socket.end()); let connections = 0;
  listener.on("connection", () => connections++);
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  const port = (listener.address() as net.AddressInfo).port;
  // Positive host controls: fixtures and the listener really are accessible.
  expect(await fs.readFile(secret, "utf8")).toContain("synthetic");
  await fs.writeFile(outside, "control"); await fs.unlink(outside);
  await new Promise<void>((resolve, reject) => { const socket = net.connect(port, "127.0.0.1"); socket.once("error", reject); socket.once("close", () => resolve()); socket.resume(); });
  expect(connections).toBe(1);
  const result = await execute(`console.error('probe:start');const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
const attempt=fn=>{try{fn();return true}catch{return false}};
const read=attempt(()=>fs.readFileSync(${JSON.stringify(secret)}));
const write=attempt(()=>fs.writeFileSync(${JSON.stringify(outside)},'escape'));
console.error('probe:direct-io');
attempt(()=>fs.symlinkSync(${JSON.stringify(root)},'link','junction'));
console.error('probe:link-created');
const symlinkRead=attempt(()=>fs.readFileSync('link/synthetic.txt'));
const symlinkWrite=attempt(()=>fs.writeFileSync('link/escaped.txt','escape'));
console.error('probe:link-io');
const child=cp.spawnSync(process.execPath,['-e','console.log("child")'],{timeout:500,windowsHide:true,stdio:'inherit'});
console.error('probe:child');
fs.writeFileSync('owned.txt','ok');
const s=net.connect(${port},'127.0.0.1');let network=false;s.on('connect',()=>{network=true;s.destroy()});s.on('error',()=>{});
setTimeout(()=>{s.destroy();console.log(JSON.stringify({read,write,symlinkRead,symlinkWrite,network,child:child.status===0,childError:child.error?.code,owned:fs.readFileSync('owned.txt','utf8'),inherited:!!process.env.ZHIXING_SANDBOX_SYNTHETIC}));},150);`);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "completed", exitCode: 0 });
  expect(JSON.parse(result.stdout)).toMatchObject({ read: false, write: false, symlinkRead: false, symlinkWrite: false, network: false, child: false, owned: "ok", inherited: false });
  expect(["EPERM", "EACCES", "UNKNOWN"]).toContain(JSON.parse(result.stdout).childError);
  expect(connections).toBe(1);
  await expect(fs.stat(outside)).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it("does not misreport an ordinary program failure or forged stdout as a successful receipt", async () => {
  const result = await execute('console.log(JSON.stringify({status:"completed",exitCode:0}));process.exit(7)');
  expect(result).toMatchObject({ status: "completed", exitCode: 7 });
  expect(result.policyId).toMatch(/^[a-f0-9]{64}$/);
}, 30_000);

it("fails before execution when a hard memory guarantee is required but unsupported", async () => {
  if (process.platform === "win32") {
    expect(await execute("console.log('bounded')", { requireHardMemoryLimit: true })).toMatchObject({ status: "completed", exitCode: 0 });
  } else {
    await expect(execute("console.log('must not execute')", { requireHardMemoryLimit: true })).rejects.toThrow("sandbox_capability_unavailable");
  }
}, 30_000);

if (process.platform === "linux") {
  it("prevents an untrusted child from stopping the supervisor or opening its control descriptor", async () => {
    const result = await execute(`const fs=require('node:fs');let signal=false,control=false;
try{process.kill(process.ppid,'SIGSTOP');signal=true;}catch{}finally{try{process.kill(process.ppid,'SIGCONT')}catch{}}
try{const fd=fs.openSync('/proc/'+process.ppid+'/fd/3','w');control=true;fs.closeSync(fd);}catch{}
console.log(JSON.stringify({signal,control}));`);
    expect(result, JSON.stringify(result)).toMatchObject({ status: "completed", exitCode: 0 });
    expect(JSON.parse(result.stdout)).toEqual({ signal: false, control: false });
  }, 30_000);
}

it("terminates an actual busy process on its wall deadline", async () => {
  const start = Date.now();
  const result = await execute("console.log('started');setInterval(()=>{},50)", { timeoutMs: 600 });
  expect(result.stdout).toContain("started"); expect(result.status).toBe("timed_out");
  expect(Date.now() - start).toBeLessThan(15_000);
}, 30_000);

it("terminates excessive output instead of silently truncating a successful execution", async () => {
  const result = await execute("setInterval(()=>process.stdout.write('中'.repeat(2048)),1)", { outputBytes: 8192 });
  expect(result).toMatchObject({ status: "resource_limited", limit: "output" });
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(8192);
}, 30_000);

it("enforces real memory and CPU budgets", async () => {
  const memory = await execute("console.log('started');const keep=[];setInterval(()=>keep.push(Buffer.alloc(4*1024*1024,1)),10)", { memoryBytes: 128 * 1024 * 1024, timeoutMs: 8000 });
  expect(memory.stdout).toContain("started");
  expect(memory).toMatchObject({ status: "resource_limited", limit: "memory" });
  const cpu = await execute("console.log('started');while(true){}", { cpuSeconds: 1, timeoutMs: 8000 });
  expect(cpu.stdout).toContain("started"); expect(cpu).toMatchObject({ status: "resource_limited", limit: "cpu" });
}, 30_000);

it("enforces a workspace quota without touching outside files", async () => {
  const result = await execute("console.log('started');const fs=require('node:fs');let i=0;setInterval(()=>{try{fs.writeFileSync('file'+i++,Buffer.alloc(65536))}catch{}},5)", { workspaceBytes: 256 * 1024, timeoutMs: 8000 });
  expect(result.stdout).toContain("started"); expect(result).toMatchObject({ status: "resource_limited", limit: "workspace" });
}, 30_000);

it("cancels an already running child and cleans its private workspace", async () => {
  const controller = new AbortController();
  if (process.platform === "win32") {
    // Windows batch cancellation is tested against a running marker in windows-sandbox.test.ts.
    // Interactive stdio/read-grant support must fail closed, never run on the host.
    await expect(new LocalSandbox().open(process.execPath, ["--version"], { allowedCommands: [process.execPath] })).rejects.toThrow("sandbox_capability_unavailable");
    return;
  }
  const session = await new LocalSandbox().open(process.execPath, ["-e", "console.log('ready');setInterval(()=>{},50)"], { allowedCommands: [process.execPath], signal: controller.signal });
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("child_not_ready")), 10_000); session.stdout.once("data", () => { clearTimeout(timer); resolve(); }); });
  controller.abort(); const result = await session.completion;
  expect(result.status).toBe("cancelled");
  await session.dispose(); await expect(fs.stat(session.directory)).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);
