import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { LocalSandbox } from "../src/local-sandbox.js";
import { executionSupport } from "../src/platform-support.js";

if (process.platform === "win32") {
  it("executes real Node in AppContainer, denies outside reads/writes, loopback and child processes", async () => {
    expect(executionSupport().available).toBe(true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-outside-"));
    const secret = path.join(root, "synthetic.txt"), outside = path.join(root, "escaped.txt");
    await fs.writeFile(secret, "synthetic private fixture");
    const server = net.createServer(socket => socket.end("escaped"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(spawnSync(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true, timeout: 2000, stdio: "ignore" }).status).toBe(0);
      const code = `console.error('probe:start');const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');console.error('probe:modules');
let read=false,write=false;try{fs.readFileSync(${JSON.stringify(secret)});read=true}catch{}console.error('probe:read');try{fs.writeFileSync(${JSON.stringify(outside)},'escape');write=true}catch{}console.error('probe:write');
const child=cp.spawnSync(process.execPath,['-e','console.log(123)'],{windowsHide:true,timeout:750,stdio:'inherit'});console.error('probe:child');fs.writeFileSync('ok.txt','owned');console.error('probe:owned');
const socket=net.connect(${port},'127.0.0.1');let connected=false;socket.on('connect',()=>{connected=true;socket.destroy()});socket.on('error',()=>{});setTimeout(()=>{socket.destroy();console.log(JSON.stringify({read,write,child:child.status===0,childError:child.error?.code,childPid:child.pid,childStatus:child.status,connected,owned:fs.readFileSync('ok.txt','utf8')}))},300);`;
      const result = await new LocalSandbox().run(process.execPath, ["-e", code], { allowedCommands: [process.execPath], timeoutMs: 5000 });
      expect(result, JSON.stringify(result)).toMatchObject({ status: "completed", exitCode: 0 });
      const { childError, ...outcome } = JSON.parse(result.stdout.trim());
      expect(outcome).toEqual({ read: false, write: false, child: false, childPid: 0, childStatus: null, connected: false, owned: "owned" });
      // A hung child or the test's timeout is not proof of sandbox denial.
      // libuv 1.51 maps ERROR_CHILD_PROCESS_BLOCKED to UNKNOWN. Also require no
      // child PID/status and prove this executable starts in the host control.
      expect(["EPERM", "EACCES", "UNKNOWN"]).toContain(childError);
      await expect(fs.stat(outside)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { server.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 30_000);
  it.each([
    { name: "Node", executable: process.execPath, electronNode: false },
    { name: "Electron Node-mode", executable: path.resolve("desktop/node_modules/electron/dist/electron.exe"), electronNode: true },
  ])("runs the actual $name test runtime under the same AppContainer policy", async ({ executable, electronNode }) => {
    const result = await new LocalSandbox().run(executable, ["--test", "--test-isolation=none", "checks.test.mjs"], {
      allowedCommands: [executable], electronNode, timeoutMs: 5000,
      files: { "checks.test.mjs": "import {test} from 'node:test';import assert from 'node:assert/strict';test('sandboxed Electron',()=>assert.equal(2+2,4));" },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "completed", exitCode: 0 });
    expect(result.stdout).toMatch(/pass 1/);
  }, 30_000);
  it("kills a timed out or cancelled container and bounds stdout", async () => {
    const sandbox = new LocalSandbox();
    const timed = await sandbox.run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { allowedCommands: [process.execPath], timeoutMs: 500 });
    expect(timed.status, timed.stderr).toBe("timed_out");
    const controller = new AbortController();
    const pending = sandbox.run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { allowedCommands: [process.execPath], timeoutMs: 5000, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 750);
    try { expect((await pending).status).toBe("cancelled"); } finally { clearTimeout(timer); }
    const output = await sandbox.run(process.execPath, ["-e", "process.stdout.write('x'.repeat(200000))"], { allowedCommands: [process.execPath], timeoutMs: 5000 });
    expect(output).toMatchObject({ status: "completed", exitCode: 0 }); expect(output.stdout.length).toBe(65536);
  }, 30_000);
} else {
  it("does not treat a Windows helper as native support on other unsupported platforms", () => {
    expect(executionSupport("linux", true).available).toBe(false);
  });
}
