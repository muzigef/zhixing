import { expect, it } from "vitest";
import { DeltaBatcher } from "../desktop/renderer/delta-batcher.js";

it("coalesces a thousand deltas, discards superseded snapshots, flushes final text and cancels timers", () => {
  let scheduled: (() => void) | undefined; const values: string[] = []; let cancelled = 0;
  const batch = new DeltaBatcher((_session, _message, text) => values.push(text), task => { scheduled = task; return () => { cancelled++; scheduled = undefined; }; });
  for (let i = 0; i < 1000; i++) batch.add("a", "m", "中");
  expect(values).toEqual([]); scheduled!(); expect(values).toEqual(["中".repeat(1000)]);
  batch.add("a", "m", "already in snapshot"); batch.discard("a"); expect(scheduled).toBeUndefined();
  batch.add("b", "m", "other topic"); batch.add("a", "m", "tail"); batch.flush("a"); expect(values.at(-1)).toBe("tail");
  batch.dispose(); expect(scheduled).toBeUndefined(); expect(values).not.toContain("other topic"); expect(cancelled).toBeGreaterThan(0);
});
