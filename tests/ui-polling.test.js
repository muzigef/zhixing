import { afterEach, expect, it, vi } from "vitest";
import { waitForIpc } from "../desktop/scripts/wait-for-ipc.mjs";

afterEach(() => vi.useRealTimers());
it("awaits async false results and polls until the IPC condition is actually true", async () => {
  vi.useFakeTimers();
  let ready = false, settled = false;
  const page = { evaluate: vi.fn(async predicate => predicate()) };
  const pending = waitForIpc(page, async () => ready, undefined, 1000).then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(100);
  expect(settled).toBe(false); expect(page.evaluate.mock.calls.length).toBeGreaterThan(1);
  ready = true; await vi.advanceTimersByTimeAsync(50); await pending;
  expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it("bounds an IPC request that never answers", async () => {
  vi.useFakeTimers();
  const page = { evaluate: vi.fn(() => new Promise(() => {})) };
  const rejected = expect(waitForIpc(page, () => false, undefined, 100)).rejects.toThrow("ipc_condition_timeout");
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(page.evaluate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("propagates an IPC error without swallowing it or continuing to poll", async () => {
  const page = { evaluate: vi.fn(async () => { throw new Error("synthetic_ipc_failure"); }) };
  await expect(waitForIpc(page, () => false)).rejects.toThrow("synthetic_ipc_failure");
  expect(page.evaluate).toHaveBeenCalledTimes(1);
});
