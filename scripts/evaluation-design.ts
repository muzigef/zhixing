import { readEvaluationJson, writeEvaluationJson } from "./evaluation-json.mjs";
import { freezeEvaluationDesign, inspectEvaluationDesign } from "../src/evaluation-design.js";
const [action, ...args] = process.argv.slice(2);
const arg = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (action === "freeze") {
  const frozen = freezeEvaluationDesign(await readEvaluationJson(arg("spec")));
  await writeEvaluationJson(arg("output"), frozen); console.log(JSON.stringify({ hash: frozen.hash, comparison: frozen.spec.comparison }));
} else if (action === "check") {
  const result = inspectEvaluationDesign(await readEvaluationJson(arg("design")), await readEvaluationJson(arg("runs")), arg("exposures") ? await readEvaluationJson(arg("exposures")) : []);
  await writeEvaluationJson(arg("output"), result); console.log(JSON.stringify(result));
  if (!result.conditionsMatched) process.exitCode = 1;
} else throw new Error("usage: freeze --spec=spec.json --output=new-design.json | check --design=design.json --runs=runs.json [--exposures=events.json] --output=new-check.json");
