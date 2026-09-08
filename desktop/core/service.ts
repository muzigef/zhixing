/** Electron is a transport adapter over the shared headless session service. */
import { AgentService } from "../../src/agent-service.js";
import type { DesktopStore } from "./store.js";
export const DesktopService = AgentService;
export type DesktopService = AgentService<DesktopStore>;
export { publicError } from "../../src/agent-errors.js";
export { DesktopDemoClient } from "./demo-client.js";
