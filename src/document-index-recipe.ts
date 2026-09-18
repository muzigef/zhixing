import { DOCUMENT_CHUNKER_VERSION } from "./document-chunking.js";
/** Bump extraction policy when PDF normalization/OCR page merging changes. Runtime engine versions are not attested by this marker. */
export const DOCUMENT_EXTRACTION_RECIPE = "pdf-page-ocr-v1";
export const DOCUMENT_INDEX_RECIPE = `${DOCUMENT_CHUNKER_VERSION}+${DOCUMENT_EXTRACTION_RECIPE}`;
