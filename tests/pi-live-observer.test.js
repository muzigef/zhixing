import { afterEach, expect, it, vi } from "vitest";
import { observePiAcceptanceTurn } from "../desktop/scripts/pi-live-observer.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture(behavior) {
  let listener;
  const unsubscribe = vi.fn();
  const invoke = vi.fn(async command => {
    if (command.type === "new") return { ok: true, data: { id: "owned-session" } };
    if (command.type === "load") return { ok: true, data: { messages: [{ status: "interrupted", text: "", timings: {} }] } };
    return behavior(command, event => listener(event));
  });
  vi.stubGlobal("window", { zhixing: { invoke, subscribe: callback => { listener = callback; return unsubscribe; } } });
  return { invoke, unsubscribe };
}
it("observes delta activities, ignores another session and cancels once before settling", async () => {
  const f = fixture(async (command, emit) => {
    if (command.type === "send") {
      emit({ type: "message_patch", sessionId: "other", changes: { activities: [{ label: "unrelated" }] } });
      emit({ type: "message_patch", sessionId: "owned-session", changes: { activities: [{ label: "正在请求模型" }] } });
      emit({ type: "message_patch", sessionId: "owned-session", changes: { activities: [{ label: "正在请求模型" }] } });
    }
    if (command.type === "stop") emit({ type: "settled", sessionId: "owned-session" });
    return { ok: true, data: {} };
  });
  const result = await observePiAcceptanceTurn({ id: "cancel", cancel: true, text: "synthetic" });
  expect(result.phases).toEqual(["正在请求模型"]);
  expect(result.cancelRequested).toBe(true);
  expect(result.cancelMs).toBeGreaterThanOrEqual(0);
  expect(f.invoke.mock.calls.filter(([c]) => c.type === "stop")).toHaveLength(1);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});
it("propagates a send error and unsubscribes without leaving a deadline", async () => {
  vi.useFakeTimers();
  const f = fixture(async () => ({ ok: false, error: "synthetic_send_failure" }));
  await expect(observePiAcceptanceTurn({ text: "synthetic" })).rejects.toThrow("synthetic_send_failure");
  expect(f.unsubscribe).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("can cancel only after receiving actual text and reuse an owned acceptance session", async () => {
  const f = fixture(async (command, emit) => {
    if (command.type === "send") {
      emit({ type: "message_patch", sessionId: "owned-session", changes: { activities: [{ label: "正在请求模型" }] } });
      emit({ type: "delta", sessionId: "other", text: "unrelated" });
      expect(f.invoke.mock.calls.some(([c]) => c.type === "stop")).toBe(false);
      emit({ type: "delta", sessionId: "owned-session", text: "合成首字" });
    }
    if (command.type === "stop") emit({ type: "settled", sessionId: "owned-session" });
    return { ok: true, data: {} };
  });
  const result = await observePiAcceptanceTurn({ id: "cancel-stream", sessionId: "owned-session", cancel: "stream", text: "synthetic" });
  expect(f.invoke.mock.calls.some(([c]) => c.type === "new")).toBe(false);
  expect(result.sessionId).toBe("owned-session"); expect(result.receivedText).toBe(true);
  expect(result.cancelRequested).toBe(true);
  expect(f.invoke.mock.calls.filter(([c]) => c.type === "stop")).toHaveLength(1);
});
it("stops its isolated app turn and releases the subscription on a missing settled event", async () => {
  vi.useFakeTimers(); const f = fixture(async () => ({ ok: true, data: {} }));
  const result = expect(observePiAcceptanceTurn({ text: "synthetic", timeoutMs: 100 })).rejects.toThrow("live_check_timeout");
  await vi.advanceTimersByTimeAsync(100); await result;
  expect(f.invoke.mock.calls.filter(([c]) => c.type === "stop")).toHaveLength(1);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
