import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const metadata = JSON.parse(await fs.readFile(path.join(root, "node_modules/electron/package.json"), "utf8"));
function run(args, env = process.env) { const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" }); if (result.status !== 0) process.exit(result.status ?? 1); }
// Electron 44 may omit its binary after npm ci. Keep installation project-local.
run([path.join(root, "node_modules/electron/install.js")]);
const binary = path.join(root, "node_modules/electron/dist", process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron");
const probe = () => spawnSync(binary, ["-e", "const DB=require('better-sqlite3'); const db=new DB(':memory:'); db.prepare('select 1').get(); db.close();"], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore" });
if (probe().status !== 0) run([path.join(root, "node_modules/@electron/rebuild/lib/cli.js"), "-f", "-w", "better-sqlite3", "-v", metadata.version]);
if (probe().status !== 0) throw new Error("Electron SQLite runtime probe failed");
console.log(`Electron ${metadata.version} / SQLite ready for ${process.platform}-${process.arch}.`);
