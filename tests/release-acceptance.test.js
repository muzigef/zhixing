import process from "node:process";
import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { releaseChannel, assessRelease } from "../desktop/scripts/release-policy.mjs";
const hash = "a".repeat(64), codeHash = "b".repeat(64);
function facts() {
  const identity = { executableSha256: hash, resourcesSha256: "c".repeat(64), codeHash };
  return { channel: "formal", platform: "darwin", arch: "arm64", version: "0.11.0", identity,
    artifacts: [{ file: "Zhixing-0.11.0-mac-arm64.dmg", sha256: "d".repeat(64) }, { file: "Zhixing-0.11.0-mac-arm64.zip", sha256: "e".repeat(64) }],
    ui: { passed: true, platform: "darwin", arch: "arm64", packaged: true, identity, groups: ["smoke", "smoke-learning", "smoke-interactions", "smoke-outcomes", "smoke-projects", "smoke-api", "smoke-team"] },
    storage: { passed: true, platform: "darwin", arch: "arm64", stages: ["create", "restart"].map(stage => ({ stage, execution: { code: 0, timedOut: false }, receipt: { stage, passed: true, packaged: true, platform: "darwin", arch: "arm64", codeHash, executableSha256: hash, capability: { available: true, backend: "keychain", api: "async" }, checks: [stage === "create" ? "encrypted_roundtrip" : "new_process_decryption", "no_plaintext_in_ciphertext", ...(stage === "restart" ? ["malformed_ciphertext_rejected"] : [])] } })) },
    artifactBindings: ["dmg", "zip"].map(extension => ({ file: `Zhixing-0.11.0-mac-arm64.${extension}`, sha256: (extension === "dmg" ? "d" : "e").repeat(64), codeHash, passed: true })),
    signature: { codesignVerified: true, developerId: true, hardenedRuntime: true, notarized: true, gatekeeperAccepted: true } };
}
it("forces version tags into formal release policy and rejects contradictory preview overrides", () => {
  expect(releaseChannel({})).toBe("preview");
  expect(releaseChannel({ GITHUB_REF: "refs/tags/v0.11.0" })).toBe("formal");
  expect(() => releaseChannel({ GITHUB_REF: "refs/tags/v0.11.0", ZHIXING_RELEASE_CHANNEL: "preview" })).toThrow("release_channel_conflict");
  expect(() => releaseChannel({ ZHIXING_RELEASE_CHANNEL: "bogus" })).toThrow();
});
it("requires bound native/UI receipts and formal macOS signing, rejecting ad-hoc, wrong builds and stale receipts", () => {
  expect(assessRelease(facts())).toMatchObject({ passed: true, formalReady: true });
  for (const change of [v => { v.signature.developerId = false; }, v => { v.signature.notarized = false; }, v => { v.ui.identity = { ...v.identity, codeHash: "f".repeat(64) }; }, v => { v.storage.stages[1].receipt.executableSha256 = "f".repeat(64); }, v => { v.storage.stages[0].receipt.packaged = false; }, v => { v.ui.groups.pop(); }, v => { v.artifacts.pop(); }, v => { v.artifactBindings = []; }]) {
    const value = facts(); change(value); expect(assessRelease(value).passed).toBe(false);
  }
});
it("keeps preview acceptance separate from formal readiness and still rejects failed product checks", () => {
  const value = facts(); value.channel = "preview"; value.signature = {};
  expect(assessRelease(value)).toMatchObject({ passed: true, formalReady: false });
  value.storage.passed = false; expect(assessRelease(value).passed).toBe(false);
});
it("requires both installed Windows executable and installer signatures with timestamps for formal release", () => {
  const value = facts(); value.platform = "win32"; value.arch = "x64";
  value.ui.platform = "win32"; value.ui.arch = "x64";
  value.storage.platform = "win32"; value.storage.arch = "x64";
  for (const stage of value.storage.stages) { stage.receipt.platform = "win32"; stage.receipt.arch = "x64"; stage.receipt.capability.backend = "dpapi"; }
  value.artifacts = [{ file: "Zhixing-0.11.0-win-x64.exe", sha256: "d".repeat(64) }];
  value.artifactBindings = [{ ...value.artifacts[0], codeHash, passed: true }];
  value.signature = { windowsExecutableValid: true, windowsInstallerValid: true, windowsTimestamped: true, windowsSamePublisher: true };
  expect(assessRelease(value).formalReady).toBe(true);
  value.signature.windowsInstallerValid = false; expect(assessRelease(value).passed).toBe(false);
});
it("runs the final release-set CLI, rejecting missing platforms and changed upload bytes", async () => {
  const fs = await import("node:fs/promises"), path = await import("node:path"), os = await import("node:os"), { createHash } = await import("node:crypto"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "release-set-"));
  const run = () => promisify(execFile)(process.execPath, ["desktop/scripts/check-release-set.mjs", root], { env: { ...process.env, RELEASE_TAG: "v0.11.0" }, timeout: 10000 });
  try {
    await expect(run()).rejects.toMatchObject({ code: 1 });
    let last;
    for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"]]) {
      const artifacts = [];
      for (const extension of platform === "darwin" ? ["dmg", "zip"] : ["exe"]) {
        const file = `Zhixing-0.11.0-${platform === "darwin" ? "mac" : "win"}-${arch}.${extension}`, bytes = Buffer.from("synthetic upload bytes; not a real executable");
        await fs.writeFile(path.join(root, file), bytes); artifacts.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") }); last = file;
      }
      await fs.writeFile(path.join(root, `release-acceptance-${platform}-${arch}.json`), JSON.stringify({ version: 1, platform, arch, appVersion: "0.11.0", channel: "formal", passed: true, formalReady: true, problems: [], identity: { codeHash }, artifacts }));
    }
    await run(); await fs.appendFile(path.join(root, last), "tampered");
    await expect(run()).rejects.toMatchObject({ code: 1 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("compares ZIP payload bytes without extraction and rejects changed, missing or outside entries", async () => {
  const fs = await import("node:fs/promises"), path = await import("node:path"), os = await import("node:os"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "release-payload-")), application = path.join(root, "Fixture.app"), zip = path.join(root, "fixture.zip");
  const python = process.platform === "win32" ? "python" : "python3", exec = promisify(execFile);
  try {
    await fs.mkdir(path.join(application, "Contents"), { recursive: true }); await fs.writeFile(path.join(application, "Contents", "fixture"), "synthetic bytes");
    const make = mode => exec(python, ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('Fixture.app/Contents/fixture', 'changed' if sys.argv[2]=='changed' else 'synthetic bytes'); z.writestr('../outside','x') if sys.argv[2]=='outside' else None; z.close()", zip, mode]);
    const verify = () => exec(python, ["desktop/scripts/verify-macos-payload.py", "zip", zip, application], { timeout: 10000 });
    await make("valid"); expect(JSON.parse((await verify()).stdout)).toMatchObject({ passed: true, entries: 1 });
    await make("changed"); await expect(verify()).rejects.toMatchObject({ code: 1 });
    await make("outside"); await expect(verify()).rejects.toMatchObject({ code: 1 });
    await expect(fs.stat(path.join(root, "outside"))).rejects.toMatchObject({ code: "ENOENT" });
    await make("valid"); await fs.writeFile(path.join(application, "Contents", "extra"), "missing from zip"); await expect(verify()).rejects.toMatchObject({ code: 1 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
