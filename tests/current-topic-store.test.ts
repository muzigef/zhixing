import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CurrentTopicStore } from "../src/current-topic-store.js";
describe("CurrentTopicStore", () => { it("restores a selected topic", async () => { const root = await mkdtemp(path.join(os.tmpdir(), "zhixing-topic-")); const store = new CurrentTopicStore(path.join(root, "current-topic.local.json")); await store.save("3dgs"); expect(await store.load()).toBe("3dgs"); }); });
