import { readFileSync } from "node:fs";

// Run with Node alone, before npm ci: a local cache must not hide private mirrors.
for (const file of ["package-lock.json", "desktop/package-lock.json"]) {
  const lock = JSON.parse(readFileSync(file, "utf8"));
  for (const [name, item] of Object.entries(lock.packages)) {
    if (item.resolved && !item.resolved.startsWith("https://registry.npmjs.org/")) throw new Error(`nonportable_dependency: ${file} ${name}`);
  }
}
console.log("lockfiles passed: public HTTPS registry only");
