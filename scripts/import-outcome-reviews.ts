import { readEvaluationJson, writeEvaluationJson } from "./evaluation-json.mjs";
import { importOutcomeBlindReviews } from "../src/outcome-blind-review.js";
import { outcomeCalibration } from "../src/outcome-calibration.js";
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
// Responses are an explicit array so two raters can be applied to the same frozen source revision.
const result = importOutcomeBlindReviews(await readEvaluationJson(arg("export")), await readEvaluationJson(arg("packet")), await readEvaluationJson(arg("coordinator")), await readEvaluationJson(arg("responses")));
await writeEvaluationJson(arg("output"), result);
console.log(JSON.stringify({ trials: result.trials.length, calibration: outcomeCalibration(result.trials), liveDatabaseModified: false }));
