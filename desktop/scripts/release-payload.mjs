import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashFile } from "./package-identity.mjs";
export async function verifyReleasePayloads(pack, artifacts, directory, installation, run) {
  const bindings = [];
  for (const artifact of artifacts) {
    const binding = { file: artifact.file, sha256: artifact.sha256, codeHash: pack.identity.codeHash, passed: false };
    const actual = path.join(directory, artifact.file);
    if (pack.platform === "darwin") {
      const script = path.join(import.meta.dirname, "verify-macos-payload.py");
      if (artifact.file.endsWith(".zip")) binding.passed = (await run("python3", [script, "zip", actual, pack.application], 180000)).ok;
      else if (artifact.file.endsWith(".dmg")) {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-release-mount-")), mount = path.join(root, "mounted");
        await fs.mkdir(mount); let mounted = false, detached = false;
        try {
          const attached = await run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, actual]);
          mounted = attached.ok;
          if (mounted) binding.passed = (await run("python3", [script, "directory", path.join(mount, path.basename(pack.application)), pack.application], 180000)).ok;
        } finally {
          const result = await run("/usr/bin/hdiutil", ["detach", mount]); detached = result.ok;
          // Never recursively remove an attached or ambiguously attached volume.
          if (detached) await fs.rm(root, { recursive: true, force: true });
          else if (!mounted) { try { await fs.rmdir(mount); await fs.rmdir(root); } catch { binding.cleanup = "owned_mount_requires_inspection"; } }
          if (mounted && !detached) { binding.passed = false; binding.cleanup = "owned_mount_requires_detach"; }
        }
      }
    } else {
      const expected = { "知行.exe": pack.identity.executableSha256, "resources/app.asar": pack.identity.resourcesSha256, "resources/runtime/build-provenance.json": await hashFile(path.join(pack.resources, "runtime/build-provenance.json")) };
      binding.passed = installation?.installed === true && installation.version === pack.version && installation.installer === artifact.file && installation.installerSha256 === artifact.sha256 && installation.codeHash === pack.identity.codeHash && Object.entries(expected).every(([file, sha256]) => installation.checks?.some(check => check.file === file && check.sha256 === sha256 && check.same === true));
    }
    if (await hashFile(actual) !== artifact.sha256) binding.passed = false;
    bindings.push(binding);
  }
  return bindings;
}
