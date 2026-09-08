import { spawnSync } from "node:child_process";
import path from "node:path";

// Electron 42+ uses UNNotification, which requires a sealed application bundle.
// A local ad-hoc signature supplies that identity without claiming Developer ID
// trust or notarization. Formal releases are signed by electron-builder instead.
export default async function signPreview(context) {
  if (context.electronPlatformName !== "darwin" || process.env.ZHIXING_SIGN_MACOS === "1") return;
  const application = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  for (const args of [["--force", "--deep", "--sign", "-", application], ["--verify", "--deep", "--strict", application]]) {
    const result = spawnSync("/usr/bin/codesign", args, { stdio: "inherit", timeout: 120000 });
    if (result.status !== 0) throw new Error("preview_codesign_failed");
  }
  console.log("macOS preview bundle ad-hoc signed and verified; not Developer ID signed or notarized.");
}
