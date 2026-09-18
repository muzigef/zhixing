import { readEvaluationJson, writeEvaluationJson } from "./evaluation-json.mjs";
import { createTeachingStudy, studyTicket, inspectTeachingStudy } from "../src/teaching-study.js";
const [command, ...args] = process.argv.slice(2), arg = (name: string) => args.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const files = args.filter(v => !v.startsWith("--"));
if (args.some(v => v.startsWith("--") && !/^--(?:plan|participants|registry|participant|output)=/.test(v))) throw new Error("study_option_invalid");
let result: unknown;
if (command === "create" && !files.length) result = createTeachingStudy(await readEvaluationJson(arg("plan")), await readEvaluationJson(arg("participants")));
else if (command === "ticket" && !files.length) result = studyTicket(await readEvaluationJson(arg("registry")), arg("participant") ?? "");
else if (command === "report" && files.length <= 100) { const exported = []; for (const file of files) exported.push(await readEvaluationJson(file, 4_000_000)); result = inspectTeachingStudy(await readEvaluationJson(arg("registry")), exported); }
else throw new Error("usage: teaching-study.ts create|ticket|report --output=new-file.json [options] [exports]");
await writeEvaluationJson(arg("output"), result);
console.log(JSON.stringify({ operation: command, saved: true, realStudyVerified: false }));
