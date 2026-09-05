import type { Citation } from "./contracts.js";
export function citationMarker(citation: Citation): string { return `[${citation.documentName}#${citation.pageNumber ? `page=${citation.pageNumber}` : `anchor=${citation.anchor ?? "root"}`}]`; }
