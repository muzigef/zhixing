import { createHash } from "node:crypto";
import type { SearchResult } from "./contracts.js";
export function sourceHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
/** Compute from the actual indexed bytes, without trusting a stale stored hash. */
export function withSourceVersion(item: SearchResult): SearchResult { return { ...item, citation: { ...item.citation, contentHash: sourceHash(item.text) } }; }
