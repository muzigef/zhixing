import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopStore } from "../desktop/core/store.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-storage-"));
  roots.push(root);
  return { root, store: new DesktopStore(root) };
}
describe("desktop storage boundaries", () => {
  it("does not follow a session-file symlink or overwrite its target", async () => {
    const { root, store } = await setup();
    const session = await store.create();
    const outside = path.join(root, "outside.json");
    await fs.writeFile(outside, JSON.stringify(session));
    const file = path.join(root, "conversations", `${session.id}.json`);
    await fs.rm(file);
    await fs.symlink(outside, file);
    await expect(store.load(session.id)).rejects.toThrow(
      "storage_path_invalid",
    );
    await expect(store.save(session)).rejects.toThrow("storage_path_invalid");
    expect(JSON.parse(await fs.readFile(outside, "utf8"))).toMatchObject({
      id: session.id,
    });
  });
  it("refuses a linked conversation directory and leaves corrupt files untouched", async () => {
    const { root, store } = await setup();
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, "conversations"));
    await expect(store.create()).rejects.toThrow("storage_path_invalid");
    await fs.rm(path.join(root, "conversations"));
    await fs.mkdir(path.join(root, "conversations"));
    const bad = path.join(
      root,
      "conversations",
      "01234567-89ab-4cde-8fab-0123456789ab.json",
    );
    await fs.writeFile(bad, "damaged fixture");
    const session = await store.create();
    expect((await store.list()).map((item) => item.id)).toEqual([session.id]);
    expect(await fs.readFile(bad, "utf8")).toBe("damaged fixture");
  });
});
