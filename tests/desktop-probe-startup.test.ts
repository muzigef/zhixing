import { afterEach, expect, it, vi } from "vitest";
const boot = vi.hoisted(() => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  const ready = deferred<void>(), result = deferred<number>();
  const run = vi.fn(() => result.promise);
  return { ready, result, run, prepare: vi.fn(async () => run), exit: vi.fn() };
});
vi.mock("../desktop/node_modules/electron/index.js", () => ({
  app: { whenReady: () => boot.ready.promise, exit: boot.exit },
  BrowserWindow: undefined, clipboard: undefined, dialog: undefined, ipcMain: undefined,
  Menu: undefined, Notification: undefined, net: undefined, protocol: undefined, shell: undefined, safeStorage: undefined,
}));
vi.mock("../desktop/electron/secure-store-probe.js", () => ({
  prepareSecureStoreProbe: boot.prepare, runSecureStoreProbe: boot.run,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("finishes the Electron entry module before ready and runs only the isolated probe afterward", async () => {
  vi.stubEnv("ZHIXING_SECURE_STORE_PROBE", "create");
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("unexpected_process_exit"); });
  const loading = import("../desktop/electron/main.js");
  await vi.waitFor(() => expect(boot.prepare.mock.calls.length + boot.run.mock.calls.length).toBeGreaterThan(0), { timeout: 10000 });
  // Electron emits ready after the entry module finishes. Awaiting the probe here deadlocks startup.
  const loaded = await Promise.race([loading.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 1000))]);
  if (!loaded) {
    boot.result.resolve(1);
    await loading.catch(() => undefined);
  }
  expect(loaded).toBe(true);
  expect(boot.prepare).toHaveBeenCalledOnce();
  expect(boot.run).not.toHaveBeenCalled();
  boot.ready.resolve();
  await vi.waitFor(() => expect(boot.run).toHaveBeenCalledOnce());
  expect(boot.exit).not.toHaveBeenCalled();
  boot.result.resolve(0);
  await vi.waitFor(() => expect(boot.exit).toHaveBeenCalledExactlyOnceWith(0));
}, 15000);
