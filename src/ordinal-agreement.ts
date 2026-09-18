import { z } from "zod/v4";
/** Descriptive paired ordinal agreement; no confidence interval or reviewer certification. */
export function ordinalAgreement(raw: readonly (readonly [number, number])[]) {
  const pairs = z.array(z.tuple([z.number().int().min(0).max(4), z.number().int().min(0).max(4)])).max(10_000).parse(raw);
  const matrix = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  for (const [a, b] of pairs) matrix[a]![b]!++;
  const n = pairs.length, rows = matrix.map(row => row.reduce((a, b) => a + b, 0)), columns = Array.from({ length: 5 }, (_, i) => matrix.reduce((sum, row) => sum + row[i]!, 0));
  let observed = 0, expected = 0;
  if (n) for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { const distance = (a - b) ** 2; observed += distance * matrix[a]![b]! / n; expected += distance * rows[a]! * columns[b]! / n ** 2; }
  return { pairs: n, matrix, exactAgreement: n ? pairs.filter(([a, b]) => a === b).length / n : null, withinOne: n ? pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length / n : null,
    meanDifferenceBMinusA: n ? pairs.reduce((sum, [a, b]) => sum + b - a, 0) / n : null, meanAbsoluteDifference: n ? pairs.reduce((sum, [a, b]) => sum + Math.abs(a - b), 0) / n : null, quadraticWeightedKappa: n && expected > 0 ? 1 - observed / expected : null };
}
