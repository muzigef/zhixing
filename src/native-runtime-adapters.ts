import { codexRuntimeAdapter } from "./native-codex.js";
import { claudeRuntimeAdapter } from "./native-claude.js";
import type { NativeVendor } from "./native-runtime-catalog.js";
import type { NativeRuntimeAdapter } from "./native-runtime-contract.js";

/** Composition root only. Adding a reviewed adapter does not change AgentService or its executor.
 * An absent adapter is an explicit extension placeholder, never a fallback to another vendor. */
export const nativeRuntimeAdapters: Readonly<Record<NativeVendor, NativeRuntimeAdapter | undefined>> = Object.freeze({
  codex: codexRuntimeAdapter,
  claude: claudeRuntimeAdapter,
  gemini: undefined,
});
