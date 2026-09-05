import { describe, expect, it } from "vitest";
import { packagedPiRequest } from "../desktop/core/pi-runner.js";
import type { PiProcessRequest } from "../src/pi-client.js";

describe("packaged Pi launcher", () => {
  it("uses the bundled runtime without bash, retains the guard and passes prompt only through stdin", () => {
    const request: PiProcessRequest = {
      command: "bash",
      args: [
        "/app/scripts/pi-safe.sh",
        "--print",
        "--mode",
        "json",
        "--no-tools",
        "--tools",
        "",
        "--no-session",
      ],
      cwd: "/app/runtime",
      input: "用户的学习问题",
      environment: { PI_OFFLINE: "1", ZHIXING_ALLOW_LIVE_PROVIDER: "0" },
    };
    const packaged = packagedPiRequest(
      request,
      "/Applications/知行.app/Contents/MacOS/知行",
      "/resources/pi/cli.js",
      "/resources/guard.mjs",
    );
    expect(packaged.command).not.toBe("bash");
    expect(packaged.args.slice(0, 5)).toEqual([
      "/resources/pi/cli.js",
      "--approve",
      "--no-extensions",
      "-e",
      "/resources/guard.mjs",
    ]);
    expect(packaged.args[packaged.args.indexOf("--tools") + 1]).toBe("");
    expect(packaged.args.join(" ")).not.toContain(request.input);
    expect(packaged.input).toBe(request.input);
    expect(packaged.environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      ZHIXING_ALLOW_LIVE_PROVIDER: "0",
    });
  });
  it("refuses to substitute a request from an unexpected launcher", () => {
    expect(() =>
      packagedPiRequest(
        {
          command: "bash",
          args: ["/unexpected.sh"],
          input: "",
          cwd: "/",
          environment: {},
        },
        "electron",
        "pi",
        "guard",
      ),
    ).toThrow("pi_launcher_invalid");
  });
});
