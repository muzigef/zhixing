const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const packagedUIGroups = ["smoke", "smoke-learning", "smoke-interactions", "smoke-outcomes", "smoke-projects", "smoke-api", "smoke-team"];
export function releaseChannel(environment = process.env) {
  const tagged = environment.GITHUB_REF?.startsWith("refs/tags/v");
  const selected = environment.ZHIXING_RELEASE_CHANNEL ?? (tagged ? "formal" : "preview");
  if (!["preview", "formal"].includes(selected)) throw new Error("release_channel_invalid");
  if (tagged && selected !== "formal") throw new Error("release_channel_conflict");
  return selected;
}
/** Gate exact artifacts and actual runner receipts. A preview is never formal-ready. */
export function assessRelease(value) {
  const problems = [], require = (condition, code) => { if (!condition) problems.push(code); };
  require(["preview", "formal"].includes(value.channel), "channel_invalid");
  require(["darwin", "win32"].includes(value.platform) && ["arm64", "x64"].includes(value.arch), "platform_unsupported");
  require(typeof value.version === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value.version), "version_invalid");
  const identity = value.identity ?? {};
  require([identity.codeHash, identity.executableSha256, identity.resourcesSha256].every(digest), "package_identity_missing");
  const ui = value.ui;
  require(ui?.passed === true && ui.packaged === true && ui.platform === value.platform && ui.arch === value.arch && ["codeHash", "executableSha256", "resourcesSha256"].every(key => ui.identity?.[key] === identity[key]) && Array.isArray(ui.groups) && ui.groups.length === packagedUIGroups.length && packagedUIGroups.every(group => ui.groups.includes(group)), "packaged_ui_receipt_invalid");
  const storage = value.storage;
  require(storage?.passed === true && storage.platform === value.platform && storage.arch === value.arch && Array.isArray(storage.stages) && storage.stages.length === 2 && ["create", "restart"].every(stage => {
    const entry = storage.stages.find(item => item.stage === stage), receipt = entry?.receipt;
    return entry?.execution?.code === 0 && entry.execution.timedOut === false && receipt?.stage === stage && receipt.passed === true && receipt.packaged === true && receipt.platform === value.platform && receipt.arch === value.arch && receipt.codeHash === identity.codeHash && receipt.executableSha256 === identity.executableSha256 && receipt.capability?.available === true && receipt.capability.api === "async" && receipt.capability.backend === (value.platform === "darwin" ? "keychain" : "dpapi") && Array.isArray(receipt.checks) && [stage === "create" ? "encrypted_roundtrip" : "new_process_decryption", "no_plaintext_in_ciphertext", ...(stage === "restart" ? ["malformed_ciphertext_rejected"] : [])].every(check => receipt.checks.includes(check));
  }), "native_storage_receipt_invalid");
  const rawArtifacts = value.artifacts ?? [], artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : [];
  require(Array.isArray(rawArtifacts) && artifacts.every(item => digest(item.sha256) && typeof item.file === "string" && !/[\/\\]/.test(item.file)) && new Set(artifacts.map(item => item.file)).size === artifacts.length, "artifact_hashes_invalid");
  if (value.channel === "formal") {
    const prefix = `Zhixing-${value.version}-${value.platform === "darwin" ? "mac" : "win"}-${value.arch}`;
    const expected = value.platform === "darwin" ? [`${prefix}.dmg`, `${prefix}.zip`] : [`${prefix}.exe`];
    require(expected.every(file => artifacts.some(item => item.file === file)), "distribution_artifacts_missing");
    require(Array.isArray(value.artifactBindings) && expected.every(file => value.artifactBindings.some(binding => binding.file === file && binding.sha256 === artifacts.find(item => item.file === file)?.sha256 && binding.codeHash === identity.codeHash && binding.passed === true)), "distribution_payload_mismatch");
    const signature = value.signature ?? {};
    if (value.platform === "darwin") {
      for (const key of ["codesignVerified", "developerId", "hardenedRuntime", "notarized", "gatekeeperAccepted"]) require(signature[key] === true, `macos_${key}_missing`);
    } else {
      for (const key of ["windowsExecutableValid", "windowsInstallerValid", "windowsTimestamped", "windowsSamePublisher"]) require(signature[key] === true, `${key}_missing`);
    }
  }
  return { version: 1, channel: value.channel, platform: value.platform, arch: value.arch, appVersion: value.version, identity, artifacts, passed: !problems.length, formalReady: value.channel === "formal" && !problems.length, problems, interpretation: "Only this exact build and supplied native runner receipts were checked. Preview, local signing, or unexecuted platform workflows never count as formal distribution acceptance. Signature validity does not guarantee SmartScreen reputation or teaching effectiveness." };
}
