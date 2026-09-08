import { defineConfig } from "vitest/config";

// CLI/Electron/SDK subprocess tests contend for CPU on shared runners. Keep the
// original per-test deadlines and bound CI concurrency instead of hiding hangs.
export default defineConfig({ test: { maxWorkers: process.env.CI ? 1 : undefined } });
