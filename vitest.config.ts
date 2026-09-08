import { defineConfig } from "vitest/config";

// CLI tests launch additional processes. Bound suite fan-out so their deadlines measure
// behavior instead of competition with dozens of simultaneous TypeScript loaders.
export default defineConfig({ test: { maxWorkers: 4 } });
