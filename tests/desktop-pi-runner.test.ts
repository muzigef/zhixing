import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packagedPiRequest, resolvePackagedPiCli } from "../desktop/core/pi-runner.js";
import type { PiProcessRequest } from "../src/pi-client.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function piFixture(packaged: boolean, entry = "dist/bundle/cli.js") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-entry-"));
  roots.push(root);
  const appPath = packaged ? path.join(root, "app.asar") : root;
  const packageRoot = path.join(packaged ? `${appPath}.unpacked` : root, "node_modules/@earendil-works/pi-coding-agent");
  await fs.mkdir(path.join(packageRoot, "dist/bundle"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ bin: { pi: entry } }));
  await fs.writeFile(path.join(packageRoot, "dist/bundle/cli.js"), "// fixture");
  return { appPath, packageRoot };
}

describe("packaged Pi launcher", () => {
  it.each([false, true])("resolves the published bundled CLI from package metadata (packaged=%s)", async (packaged) => {
    const { appPath, packageRoot } = await piFixture(packaged);
    await expect(resolvePackagedPiCli(appPath)).resolves.toBe(path.join(packageRoot, "dist/bundle/cli.js"));
  });
  it("rejects an entry outside the installed Pi package", async () => {
    const { appPath } = await piFixture(false, "../outside.js");
    await expect(resolvePackagedPiCli(appPath)).rejects.toThrow("pi_entry_invalid");
  });
  it("fails when the declared CLI is missing instead of using a private module", async () => {
    const { appPath } = await piFixture(false, "dist/missing.js");
    await expect(resolvePackagedPiCli(appPath)).rejects.toThrow();
  });
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
