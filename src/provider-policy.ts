/** Allows configured Providers by default; users can explicitly force local-only mode with =0. */
export function assertLiveProviderAllowed(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.ZHIXING_ALLOW_LIVE_PROVIDER === "0") {
    throw new Error("live_provider_disabled: 当前会话已显式禁用外部 Provider。");
  }
}
