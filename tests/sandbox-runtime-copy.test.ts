import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { copySandboxRuntimeDirectory } from "../src/sandbox-runtime-copy.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-runtime-copy-")); roots.push(root);
  const source = path.join(root, "source"), target = path.join(root, "target"); await fs.mkdir(source);
  return { root, source, target };
}
it("copies nested runtime files while excluding site packages, bytecode caches and junctions", async () => {
  const { source, target, root } = await fixture();
  for (const name of ["package", "site-packages", "__pycache__"]) { await fs.mkdir(path.join(source, name)); await fs.writeFile(path.join(source, name, "file.py"), "stdlib"); }
  const outside = path.join(root, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "private.py"), "synthetic");
  await fs.symlink(outside, path.join(source, "link"), process.platform === "win32" ? "junction" : "dir");
  expect(await copySandboxRuntimeDirectory(source, target, 10, 100)).toBe(16);
  expect(await fs.readFile(path.join(target, "package/file.py"), "utf8")).toBe("stdlib");
  expect(await fs.readdir(target)).toEqual(["package"]);
});
it("rejects runtime byte-budget overflow before dispatching file copies", async () => {
  const { source, target } = await fixture(); await fs.writeFile(path.join(source, "big.py"), "123456");
  const spy = vi.spyOn(fs, "copyFile");
  await expect(copySandboxRuntimeDirectory(source, target, 5, 10)).rejects.toThrow("sandbox_runtime_limit");
  expect(spy).not.toHaveBeenCalled();
});
it("bounds concurrent copies and waits for all in-flight I/O when cancelled", async () => {
  const { source, target } = await fixture();
  for (let i = 0; i < 20; i++) await fs.writeFile(path.join(source, `${i}.py`), "test");
  const controller = new AbortController(), original = fs.copyFile.bind(fs);
  let active = 0, peak = 0, started = 0;
  vi.spyOn(fs, "copyFile").mockImplementation(async (...args) => {
    active++; started++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); await original(...args); }
    finally { active--; }
  });
  await expect(copySandboxRuntimeDirectory(source, target, 0, 1000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(8); expect(started).toBeLessThanOrEqual(8); expect(active).toBe(0);
});
it("does not continue copying or leave background writes after an I/O error", async () => {
  const { source, target } = await fixture();
  for (let i = 0; i < 20; i++) await fs.writeFile(path.join(source, `${i}.py`), "test");
  let active = 0, count = 0;
  vi.spyOn(fs, "copyFile").mockImplementation(async () => {
    active++; const first = ++count === 1;
    try { await new Promise(resolve => setTimeout(resolve, first ? 1 : 10)); if (first) throw new Error("synthetic_copy_failure"); }
    finally { active--; }
  });
  await expect(copySandboxRuntimeDirectory(source, target, 0, 1000)).rejects.toThrow("synthetic_copy_failure");
  expect(active).toBe(0); expect(count).toBeLessThanOrEqual(8);
});
