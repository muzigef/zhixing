import { describe, expect, it } from "vitest";
import { assertLiveProviderAllowed } from "../src/provider-policy.js";

describe("Provider policy", () => {
  it("默认拒绝知行应用调用外部 Provider", () => {
    expect(() => assertLiveProviderAllowed({})).toThrow("live_provider_disabled");
  });

  it("仅显式开关允许未来 live Provider adapter", () => {
    expect(() => assertLiveProviderAllowed({ ZHIXING_ALLOW_LIVE_PROVIDER: "1" })).not.toThrow();
  });
});
