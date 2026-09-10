import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const localSigningConfig = path.resolve(import.meta.dirname, "../.local/macos-signing.json");
const commandOptions = { encoding: "utf8", timeout: 15_000, maxBuffer: 128_000 };
function fingerprint(value) {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{40}$/.test(value)) throw new Error("invalid_local_signing_identity");
  return value.toUpperCase();
}
export function parseSigningIdentities(output) {
  return String(output ?? "").split("\n").flatMap(line => {
    const match = /^\s*\d+\) ([a-fA-F0-9]{40}) "([^"\r\n]+)"\s*$/.exec(line);
    return match ? [{ fingerprint: match[1].toUpperCase(), name: match[2] }] : [];
  });
}
export function listSigningIdentities(run = spawnSync) {
  // Public identity metadata only; never export certificates' private keys.
  const result = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], commandOptions);
  if (result.status !== 0 || result.error) throw new Error("local_signing_identity_query_failed");
  return parseSigningIdentities(result.stdout);
}
function readConfig(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error();
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.version !== 1 || Object.keys(value).sort().join(",") !== "fingerprint,version") throw new Error();
    return fingerprint(value.fingerprint);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error("invalid_local_signing_config");
  }
}
export function assertSigningIdentityAvailable(identity, run = spawnSync) {
  if (!listSigningIdentities(run).some(item => item.fingerprint === identity)) throw new Error("local_signing_identity_unavailable: 固定的代码签名证书不可用；请检查钥匙串中的有效期、私钥和代码签名信任。不会退回临时签名。");
}
export function getSigningPlan({ platform = process.platform, environment = process.env, configFile = localSigningConfig, run = spawnSync } = {}) {
  if (platform !== "darwin") return { mode: "none" };
  if (environment.ZHIXING_SIGN_MACOS === "1") {
    if (environment.ZHIXING_LOCAL_SIGNING_IDENTITY) throw new Error("macos_signing_mode_conflict");
    return { mode: "release" };
  }
  const configured = readConfig(configFile);
  const requested = environment.ZHIXING_LOCAL_SIGNING_IDENTITY === undefined ? undefined : fingerprint(environment.ZHIXING_LOCAL_SIGNING_IDENTITY);
  if (configured && requested && configured !== requested) throw new Error("local_signing_identity_conflict");
  const identity = configured ?? requested;
  if (identity) {
    assertSigningIdentityAvailable(identity, run);
    return { mode: "local", fingerprint: identity };
  }
  if (environment.ZHIXING_ALLOW_ADHOC === "1") return { mode: "adhoc" };
  throw new Error("macos_signing_not_configured: 请先运行 npm --prefix desktop run signing:configure -- <证书 SHA-1 指纹>。仅一次性测试包可显式设置 ZHIXING_ALLOW_ADHOC=1；该模式更新后可能再次请求钥匙串授权。");
}
export function configureLocalSigning(value, { platform = process.platform, configFile = localSigningConfig, run = spawnSync } = {}) {
  if (platform !== "darwin") throw new Error("local_signing_requires_macos");
  const identity = fingerprint(value);
  const previous = readConfig(configFile);
  if (previous && previous !== identity) throw new Error("local_signing_identity_conflict");
  assertSigningIdentityAvailable(identity, run);
  if (!previous) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configFile, `${JSON.stringify({ version: 1, fingerprint: identity }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  return identity;
}
export function designatedRequirement(identity) {
  return `designated => identifier "com.zhixing.desktop" and certificate leaf = H"${fingerprint(identity)}"`;
}
export function verifyLocalSignature(application, identity, run = spawnSync) {
  for (const args of [["--verify", "--deep", "--strict", application], ["-d", "-r-", application]]) {
    const result = run("/usr/bin/codesign", args, commandOptions);
    if (result.status !== 0 || result.error) throw new Error("local_codesign_verification_failed");
    if (args.includes("-r-")) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const requirement = output.split("\n").find(line => line.startsWith("designated => "));
      // codesign may omit quotes around a simple identifier when displaying it.
      const normalized = requirement
        ?.replace('identifier com.zhixing.desktop ', 'identifier "com.zhixing.desktop" ')
        .replace(/H"([a-fA-F0-9]{40})"/g, (_match, hash) => `H"${hash.toUpperCase()}"`);
      if (normalized !== designatedRequirement(identity)) throw new Error("unstable_local_signing_requirement");
    }
  }
}
