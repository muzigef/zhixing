import { defineConfig } from "vitest/config";

// CLI/Electron/SDK subprocess tests contend for CPU on shared runners. Keep the
// explicit runtime deadlines and bound CI concurrency. Multi-process journeys
// declare their own composite deadlines; each child process is bounded as well.
export default defineConfig({ test: { maxWorkers: process.env.CI ? 1 : undefined } });
