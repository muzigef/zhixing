export function packagingConfiguration(plan, sourceEnvironment) {
  const environment = { ...sourceEnvironment };
  if (plan.mode === "release") {
    for (const key of ["CSC_LINK", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
      if (!environment[key]) throw new Error(`Signing configuration missing: ${key}`);
    }
    return { environment, config: { forceCodeSigning: true, mac: { hardenedRuntime: true, notarize: true } } };
  }
  // Empty secrets confuse electron-builder; unrelated local identities must not
  // replace the pinned signature after our hook has signed the application.
  for (const key of ["CSC_NAME", "CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) delete environment[key];
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  if (plan.mode === "local") environment.ZHIXING_LOCAL_SIGNING_IDENTITY = plan.fingerprint;
  return { environment, config: ["local", "adhoc"].includes(plan.mode) ? { mac: { identity: null } } : {} };
}
