import { readEvaluationJson, writeEvaluationJson } from "./evaluation-json.mjs";
import { reviewQuality, summarizeQuality } from "../src/quality-review.js";
import { parseQualityReport } from "../src/quality-report-contracts.js";
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const report = parseQualityReport(await readEvaluationJson(arg("report")));
const review = arg("reviews") ? reviewQuality(report, await readEvaluationJson(arg("reviews"))) : undefined;
const output = arg("output"); const result = { summary: summarizeQuality(report, review), ...(review ? { review } : {}) };
if (output) await writeEvaluationJson(output, result);
console.log(JSON.stringify(result.summary, null, 2));
