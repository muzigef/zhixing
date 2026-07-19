import { describe, expect, it } from "vitest";
import { assertLiveProviderAllowed } from "../src/provider-policy.js";

describe("Provider policy", () => {
  it("默认允许已配置的知行 Provider", () => {
    expect(() => assertLiveProviderAllowed({})).not.toThrow();
  });

  it("显式本地模式会禁用 Provider", () => {
    expect(() => assertLiveProviderAllowed({ ZHIXING_ALLOW_LIVE_PROVIDER: "0" })).toThrow("live_provider_disabled");
  });
});
