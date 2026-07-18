/** Guards future application Provider adapters; this does not affect Pi's development model. */
export function assertLiveProviderAllowed(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.ZHIXING_ALLOW_LIVE_PROVIDER !== "1") {
    throw new Error("live_provider_disabled: 默认纯本地模式禁止知行应用调用外部 Provider。");
  }
}
