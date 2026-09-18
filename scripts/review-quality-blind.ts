import path from "node:path";
import { readEvaluationJson, writeEvaluationJson, createEvaluationDirectory } from "./evaluation-json.mjs";
import { parseQualityReport } from "../src/quality-report-contracts.js";
import { createQualityBlindPacket, importQualityBlindReview, compareQualityReviewers } from "../src/quality-blind-review.js";
import { reviewQuality, type QualityReview } from "../src/quality-review.js";
const [action, ...args] = process.argv.slice(2);
const arg = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const report = parseQualityReport(await readEvaluationJson(arg("report")));
const canonical = (review: QualityReview) => ({ ...review, scores: review.scores.map(({ criteriaVerdict, verdict, ...score }) => { void criteriaVerdict; void verdict; return score; }) });
if (action === "create") {
  const output = arg("output"); if (!output) throw new Error("output_required");
  const pack = createQualityBlindPacket(report);
  await createEvaluationDirectory(output);
  await writeEvaluationJson(path.join(output, "reviewer.json"), pack.packet);
  await writeEvaluationJson(path.join(output, "coordinator-private.json"), pack.coordinator);
  console.log(JSON.stringify({ items: pack.packet.items.length, completedReviews: 0 }));
} else if (action === "import") {
  const result = importQualityBlindReview(report, await readEvaluationJson(arg("packet")), await readEvaluationJson(arg("coordinator")), await readEvaluationJson(arg("response")));
  await writeEvaluationJson(arg("output"), canonical(result.review)); console.log(JSON.stringify({ reviewed: result.review.scores.length, blindness: result.blindness }));
} else if (action === "compare" || action === "calibrate") {
  const a = reviewQuality(report, await readEvaluationJson(arg(action === "calibrate" ? "reference" : "a"))), b = reviewQuality(report, await readEvaluationJson(arg(action === "calibrate" ? "reviews" : "b")));
  const comparison = compareQualityReviewers(report, a, b);
  const result = { purpose: action === "calibrate" ? "reference_comparison_only" : "reviewer_agreement", automaticCertification: false, ...comparison };
  await writeEvaluationJson(arg("output"), result); console.log(JSON.stringify({ pairedItems: comparison.pairedItems, automaticCertification: false }));
} else throw new Error("usage: create|import|compare|calibrate --report=quality.json --output=new-artifact");
