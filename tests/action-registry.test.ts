import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/action-registry.js";
import { decideInteraction } from "../src/interaction-protocol.js";

describe("ActionRegistry", () => {
  it("assigns stable action IDs, risk and confirmation before CLI handlers run", () => {
    const registry = new ActionRegistry();
    expect(registry.resolve("开始第 2 天")).toMatchObject({ id: "learning.start_day", risk: "write", input: { day: 2 } });
    expect(registry.resolve("删除资料 rag doc-1 --确认")).toMatchObject({ id: "library.delete", risk: "destructive", confirmationRequired: true, confirmed: true });
  });
  it("requires normal provider confirmation when selecting Pi Codex", () => {
    expect(new ActionRegistry().resolve("模型切换 tutor pi-codex --确认")).toMatchObject({ id: "provider.route", confirmed: true, confirmationRequired: true, input: { provider: "pi-codex" } });
    expect(decideInteraction("模型切换 tutor pi-codex", "teaching")).toMatchObject({ kind: "command", actionId: "provider.route", confirmed: false });
  });
  it("keeps registered commands out of the free-form teaching channel", () => {
    expect(decideInteraction("模型切换 tutor mock", "teaching")).toMatchObject({ kind: "command", actionId: "provider.route", confirmed: false });
  });
});
