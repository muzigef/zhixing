import { verifyReleasePayloads } from "./release-payload.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { packageIdentity, sha256, hashFile } from "./package-identity.mjs";
import { releaseChannel, assessRelease } from "./release-policy.mjs";
import { readEvaluationJson, writeEvaluationJson } from "../../scripts/evaluation-json.mjs";
const args = process.argv.slice(2), arg = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg("output") || args.some(value => !/^--(?:output|ui|storage|artifacts)=/.test(value))) throw new Error("usage: --output=new-release-receipt.json --ui=ui.json --storage=storage.json --artifacts=release-directory");
const pack = await packageIdentity(process.env.ZHIXING_DESKTOP_EXECUTABLE), channel = releaseChannel(), directory = path.resolve(arg("artifacts") ?? path.join(import.meta.dirname, "../release"));
const artifacts = [], prefix = `Zhixing-${pack.version}-${pack.platform === "darwin" ? "mac" : "win"}-${pack.arch}`;
for (const extension of pack.platform === "darwin" ? ["dmg", "zip"] : ["exe"]) {
  const file = `${prefix}.${extension}`;
  try { const stat = await fs.lstat(path.join(directory, file)); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("release_artifact_invalid"); artifacts.push({ file, sha256: await hashFile(path.join(directory, file)) }); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function run(command, commandArgs, timeout = 60000) {
  try { return { ok: true, ...await promisify(execFile)(command, commandArgs, { timeout, maxBuffer: 128000, windowsHide: true }) }; } catch { return { ok: false, stdout: "", stderr: "" }; }
}
const signature = {};
if (pack.platform === "darwin") {
  signature.codesignVerified = (await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", pack.application])).ok;
  const inspected = await run("/usr/bin/codesign", ["-d", "--verbose=4", pack.application]), text = inspected.stdout + "\n" + inspected.stderr;
  signature.developerId = inspected.ok && /^Authority=Developer ID Application: /m.test(text);
  signature.hardenedRuntime = inspected.ok && /flags=0x[0-9a-f]+\([^\n)]*runtime/.test(text);
  signature.notarized = false; signature.gatekeeperAccepted = false;
  if (channel === "formal" && signature.codesignVerified && signature.developerId) {
    signature.notarized = (await run("/usr/bin/xcrun", ["stapler", "validate", pack.application])).ok;
    signature.gatekeeperAccepted = (await run("/usr/sbin/spctl", ["--assess", "--type", "execute", pack.application])).ok;
  }
} else {
  const check = async target => { const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(import.meta.dirname, "inspect-authenticode.ps1"), "-Target", target]); try { return result.ok ? JSON.parse(result.stdout) : {}; } catch { return {}; } };
  const binary = await check(pack.executable), installer = await check(path.join(directory, `${prefix}.exe`));
  signature.windowsExecutableValid = binary.valid === true; signature.windowsInstallerValid = installer.valid === true; signature.windowsTimestamped = binary.timestamped === true && installer.timestamped === true;
  signature.windowsSamePublisher = typeof binary.signerThumbprint === "string" && /^[a-f0-9]{40}$/i.test(binary.signerThumbprint) && binary.signerThumbprint === installer.signerThumbprint;
}
const readReceipt = async selected => { if (!selected) return null; try { return await readEvaluationJson(selected); } catch { return null; } };
const ui = await readReceipt(arg("ui")), storage = await readReceipt(arg("storage"));
const installation = pack.platform === "win32" ? await readReceipt(path.join(directory, "acceptance-windows.json")) : null;
const artifactBindings = channel === "formal" ? await verifyReleasePayloads(pack, artifacts, directory, installation, run) : [];
const result = assessRelease({ artifactBindings, channel, platform: pack.platform, arch: pack.arch, version: pack.version, identity: pack.identity, artifacts, signature, ui, storage });
if (JSON.stringify((await packageIdentity(pack.executable)).identity) !== JSON.stringify(pack.identity)) { result.passed = false; result.formalReady = false; result.problems.push("package_changed_during_verification"); }
await writeEvaluationJson(arg("output"), { ...result, checkedAt: new Date().toISOString(), signature, artifactBindings, receiptHashes: { ui: ui ? sha256(JSON.stringify(ui)) : null, storage: storage ? sha256(JSON.stringify(storage)) : null } });
console.log(JSON.stringify({ passed: result.passed, formalReady: result.formalReady, problems: result.problems }));
if (!result.passed) process.exitCode = 1;
