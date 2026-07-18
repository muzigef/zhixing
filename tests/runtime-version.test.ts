import { describe, expect, it } from "vitest";
import { assertSupportedNodeVersion } from "../src/runtime-version.js";

describe("runtime version", () => {
  it("接受冻结的 Node 24.8.x", () => {
    expect(() => assertSupportedNodeVersion("24.8.0")).not.toThrow();
  });

  it("拒绝未冻结的 Node 版本", () => {
    expect(() => assertSupportedNodeVersion("24.9.0")).toThrow("unsupported_node_version");
  });
});
