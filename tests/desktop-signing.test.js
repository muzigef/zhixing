import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureLocalSigning, getSigningPlan, parseSigningIdentities, verifyLocalSignature } from "../desktop/scripts/macos-signing.mjs";
import signPreview from "../desktop/scripts/sign-preview.mjs";
import { packagingConfiguration } from "../desktop/scripts/packaging-config.mjs";

const fingerprint = "A".repeat(40);
const other = "B".repeat(40);
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixing-signing-")); roots.push(root);
  return { platform: "darwin", environment: {}, configFile: path.join(root, "signing.json"), run: vi.fn(() => ({ status: 0, stdout: `  1) ${fingerprint} "Zhixing Local Development"\n     1 valid identities found\n` })) };
}

it("requires a deliberate signing choice and never silently produces a new ad-hoc identity", () => {
  expect(() => getSigningPlan(fixture())).toThrow("macos_signing_not_configured");
});
it("supports explicitly disposable ad-hoc CI previews, and never probes keychains on Windows", () => {
  const options = fixture();
  expect(getSigningPlan({ ...options, environment: { ZHIXING_ALLOW_ADHOC: "1" } })).toEqual({ mode: "adhoc" });
  expect(getSigningPlan({ ...options, platform: "win32" })).toEqual({ mode: "none" });
  expect(options.run).not.toHaveBeenCalled();
});
it("pins a full fingerprint persistently and resolves it on later builds", () => {
  const options = fixture();
  configureLocalSigning(fingerprint.toLowerCase(), options);
  expect(JSON.parse(fs.readFileSync(options.configFile, "utf8"))).toEqual({ version: 1, fingerprint });
  expect(getSigningPlan(options)).toEqual({ mode: "local", fingerprint });
  expect(options.run).toHaveBeenCalledWith("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], expect.any(Object));
});
it("does not let ad-hoc opt-in or an env identity override the configured identity", () => {
  const options = fixture(); configureLocalSigning(fingerprint, options);
  expect(getSigningPlan({ ...options, environment: { ZHIXING_ALLOW_ADHOC: "1" } }).mode).toBe("local");
  expect(() => getSigningPlan({ ...options, environment: { ZHIXING_LOCAL_SIGNING_IDENTITY: other } })).toThrow("local_signing_identity_conflict");
  expect(() => configureLocalSigning(other, options)).toThrow("local_signing_identity_conflict");
});
it("fails closed if the pinned identity is missing, expired, or the identity query fails", () => {
  const options = fixture(); configureLocalSigning(fingerprint, options);
  for (const output of [{ status: 0, stdout: "0 valid identities found" }, { status: 0, stdout: `1) ${fingerprint} "Expired" (CSSMERR_TP_CERT_EXPIRED)` }, { status: 1, stdout: "" }]) {
    expect(() => getSigningPlan({ ...options, environment: { ZHIXING_ALLOW_ADHOC: "1" }, run: () => output })).toThrow();
  }
});
it("rejects certificate names, shell fragments, malformed config and symlinks", () => {
  const options = fixture();
  for (const value of ["-", "Zhixing Local Development", "$(echo nope)", "A".repeat(39)]) expect(() => configureLocalSigning(value, options)).toThrow("invalid_local_signing_identity");
  fs.writeFileSync(options.configFile, "{}");
  expect(() => getSigningPlan({ ...options, environment: { ZHIXING_ALLOW_ADHOC: "1" } })).toThrow("invalid_local_signing_config");
  const linked = `${options.configFile}.link`; fs.symlinkSync(options.configFile, linked);
  expect(() => getSigningPlan({ ...options, configFile: linked })).toThrow("invalid_local_signing_config");
});
it("keeps formal Developer ID signing separate and rejects contradictory env flags", () => {
  const options = fixture();
  expect(getSigningPlan({ ...options, environment: { ZHIXING_SIGN_MACOS: "1" } })).toEqual({ mode: "release" });
  expect(() => getSigningPlan({ ...options, environment: { ZHIXING_SIGN_MACOS: "1", ZHIXING_LOCAL_SIGNING_IDENTITY: fingerprint } })).toThrow("macos_signing_mode_conflict");
});
it("parses only complete valid identity lines, not unrelated fingerprints or errors", () => {
  expect(parseSigningIdentities(` 1) ${fingerprint} "Local"\n2) ${other} "Expired" (CSSMERR_TP_CERT_EXPIRED)\n 2 valid identities found`)).toEqual([{ fingerprint, name: "Local" }]);
});
it("signs nested Electron code using the pinned identity and certificate-bound main requirement", async () => {
  const sign = vi.fn(async () => {});
  const application = "/tmp/知行.app";
  const requirement = `designated => identifier "com.zhixing.desktop" and certificate leaf = H"${fingerprint}"`;
  const run = vi.fn((command, args) => ({ status: 0, stdout: command === "/usr/bin/security" ? `1) ${fingerprint} "Local"` : "", stderr: args.includes("-r-") ? requirement : "" }));
  await signPreview({ electronPlatformName: "darwin", appOutDir: "/tmp", packager: { appInfo: { productFilename: "知行" } } }, { plan: { mode: "local", fingerprint }, sign, run, log: () => {} });
  const options = sign.mock.calls[0][0];
  expect(options.identity).toBe(fingerprint);
  // osx-sign queries generic identity trust, which excludes a certificate that
  // is correctly trusted for code signing only. Our policy-specific precheck
  // must run before delegating to that library.
  expect(run).toHaveBeenCalledWith("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], expect.any(Object));
  expect(options.identityValidation).toBe(false);
  expect(options.optionsForFile(application).requirements).toBe(`=${requirement}`);
  expect(options.optionsForFile("/tmp/知行.app/Contents/Frameworks/Helper.app").requirements).toBeUndefined();
  expect(run).toHaveBeenCalledWith("/usr/bin/codesign", ["--verify", "--deep", "--strict", application], expect.any(Object));
});
it("refuses to delegate signing if the certificate loses code-signing trust after packaging preflight", async () => {
  const sign = vi.fn(async () => {});
  await expect(signPreview({ electronPlatformName: "darwin", appOutDir: "/tmp", packager: { appInfo: { productFilename: "知行" } } }, { plan: { mode: "local", fingerprint }, sign, run: () => ({ status: 0, stdout: "0 valid identities found" }), log: () => {} })).rejects.toThrow("local_signing_identity_unavailable");
  expect(sign).not.toHaveBeenCalled();
});
it("rejects a hash-only or different certificate requirement even when codesign verification succeeds", () => {
  for (const requirement of [`designated => cdhash H"${fingerprint}"`, `designated => identifier "com.zhixing.desktop" and certificate leaf = H"${other}"`]) {
    expect(() => verifyLocalSignature("/tmp/知行.app", fingerprint, () => ({ status: 0, stderr: requirement }))).toThrow("unstable_local_signing_requirement");
  }
});
it("accepts macOS canonical lowercase certificate hashes while preserving the exact identifier constraint", () => {
  for (const identifier of ['"com.zhixing.desktop"', "com.zhixing.desktop"]) {
    const requirement = `designated => identifier ${identifier} and certificate leaf = H"${fingerprint.toLowerCase()}"`;
    expect(() => verifyLocalSignature("/tmp/知行.app", fingerprint, () => ({ status: 0, stderr: requirement }))).not.toThrow();
  }
  const widened = `designated => identifier "com.zhixing.desktop" or certificate leaf = H"${fingerprint.toLowerCase()}"`;
  expect(() => verifyLocalSignature("/tmp/知行.app", fingerprint, () => ({ status: 0, stderr: widened }))).toThrow("unstable_local_signing_requirement");
});
it("prevents electron-builder from replacing a local signature using an automatically discovered certificate", () => {
  const result = packagingConfiguration({ mode: "local", fingerprint }, { CSC_NAME: "unrelated", CSC_LINK: "", CSC_KEY_PASSWORD: "" });
  expect(result.config).toEqual({ mac: { identity: null } });
  expect(result.environment.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false");
  expect(result.environment.ZHIXING_LOCAL_SIGNING_IDENTITY).toBe(fingerprint);
  expect(result.environment).not.toHaveProperty("CSC_NAME");
  expect(result.environment).not.toHaveProperty("CSC_LINK");
});
it("preserves formal release signing requirements and Windows packaging", () => {
  expect(() => packagingConfiguration({ mode: "release" }, {})).toThrow("Signing configuration missing");
  const environment = { CSC_LINK: "fixture", APPLE_ID: "fixture", APPLE_APP_SPECIFIC_PASSWORD: "fixture", APPLE_TEAM_ID: "fixture" };
  expect(packagingConfiguration({ mode: "release" }, environment).config).toEqual({ forceCodeSigning: true, mac: { hardenedRuntime: true, notarize: true } });
  expect(packagingConfiguration({ mode: "none" }, {}).config).toEqual({});
});
