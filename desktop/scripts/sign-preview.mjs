import { spawnSync } from "node:child_process";
import path from "node:path";
import { getSigningPlan, designatedRequirement, verifyLocalSignature, assertSigningIdentityAvailable } from "./macos-signing.mjs";

// Electron 42+ uses UNNotification, which requires a sealed application bundle.
// Local development uses a persistent certificate. Ad-hoc is an explicit
// disposable-test choice only. Formal releases are signed by electron-builder.
export default async function signPreview(context, { plan, sign, run = spawnSync, log = console.log } = {}) {
  if (context.electronPlatformName !== "darwin") return;
  plan ??= getSigningPlan();
  if (plan.mode === "release") return;
  const application = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (plan.mode === "local") {
    // Validate the pinned identity under the Code Signing policy immediately
    // before use. osx-sign's generic find-identity probe incorrectly excludes
    // self-signed certificates trusted only for Code Signing (least privilege).
    assertSigningIdentityAvailable(plan.fingerprint, run);
    sign ??= (await import("@electron/osx-sign")).signAsync;
    await sign({
      app: application, platform: "darwin", type: "development",
      identity: plan.fingerprint, identityValidation: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false, gatekeeperAssess: false,
      optionsForFile: file => ({
        hardenedRuntime: false, timestamp: "none",
        entitlements: path.resolve(import.meta.dirname, "../assets/entitlements.local.plist"),
        ...(file === application ? { requirements: `=${designatedRequirement(plan.fingerprint)}` } : {}),
      }),
    });
    verifyLocalSignature(application, plan.fingerprint, run);
    log("macOS local development signature verified with a pinned certificate identity; not notarized.");
    return;
  }
  if (plan.mode !== "adhoc") throw new Error("invalid_preview_signing_mode");
  for (const args of [["--force", "--deep", "--sign", "-", application], ["--verify", "--deep", "--strict", application]]) {
    const result = run("/usr/bin/codesign", args, { stdio: "inherit", timeout: 120000 });
    if (result.status !== 0) throw new Error("preview_codesign_failed");
  }
  log("WARNING: disposable ad-hoc preview; rebuilding changes its Keychain identity and can prompt again. Not Developer ID signed or notarized.");
}
