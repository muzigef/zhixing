import crypto from "node:crypto";

export interface EmbeddingModel { embed(text: string): readonly number[]; }

/** Deterministic local embedding fallback; replaceable with a local model without changing storage. */
export class HashEmbeddingModel implements EmbeddingModel {
  constructor(private readonly dimensions = 64) {}
  embed(text: string): readonly number[] {
    const vector = Array.from({ length: this.dimensions }, () => 0);
    for (const token of tokens(text)) {
      const hash = crypto.createHash("sha256").update(token).digest();
      const index = hash.readUInt16BE(0) % this.dimensions;
      const sign = (hash[2] ?? 0) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).flatMap((token) => /\p{Script=Han}/u.test(token) ? Array.from(token) : [token]);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { dot += (left[index] ?? 0) * (right[index] ?? 0); leftNorm += (left[index] ?? 0) ** 2; rightNorm += (right[index] ?? 0) ** 2; }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
