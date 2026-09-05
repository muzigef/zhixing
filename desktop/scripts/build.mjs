import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
await fs.mkdir(path.join(root, "build/runtime"), { recursive: true });
await build({
  entryPoints: [path.join(root, "electron/main.ts")],
  outfile: path.join(root, "build/main.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: [path.join(root, "electron/preload.ts")],
  outfile: path.join(root, "build/preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: [path.join(root, "../.pi/extensions/zhixing-guard.ts")],
  outfile: path.join(root, "build/runtime/zhixing-guard.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});
await fs.copyFile(
  path.join(root, "runtime-AGENTS.md"),
  path.join(root, "build/runtime/AGENTS.md"),
);
await build({
  entryPoints: [path.join(root, "renderer/index.tsx")],
  outdir: path.join(root, "build/renderer"),
  entryNames: "app",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome140",
  minify: true,
  sourcemap: true,
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
});
await fs.copyFile(
  path.join(root, "renderer/index.html"),
  path.join(root, "build/renderer/index.html"),
);
console.log("Desktop built: main, sandboxed preload, renderer and Pi guard.");
