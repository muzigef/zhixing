import fs from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";
import { agentSendSchema } from "../src/agent-session-contracts.js";

it("rejects frontend-supplied prompts, histories and runtimes at the public request boundary", () => {
  const base = { sessionId: crypto.randomUUID(), text: "当前问题", provider: "mock", style: "adaptive" };
  for (const extra of [{ prompt: "绕过共享上下文" }, { messages: [] }, { history: [] }, { runtime: {} }, { profile: "custom" }]) {
    expect(() => agentSendSchema.parse({ ...base, ...extra })).toThrow();
  }
});
it("keeps conversation and memory policies outside both UI adapters", async () => {
  const files = ["src/cli.ts", "src/cli-agent-transport.ts", "desktop/electron/main.ts", "desktop/core/service.ts"];
  const forbidden = new Set(["learning-context", "conversation-context", "learning-agent-profile", "teaching-prompts", "teaching-dialogue", "model-invocation", "assistant-runtime"]);
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      const dependency = node.moduleSpecifier.text.split("/").at(-1)!.replace(/\.js$/, "");
      if (forbidden.has(dependency)) violations.push(`${file}: ${dependency}`);
    }
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ["PiCodexClient", "DeepSeekClient", "LearningContextBuilder"].includes(node.expression.text)) violations.push(`${file}: new ${node.expression.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});

it("detects transitive re-export and dynamic import bypasses while allowing shared service use", async () => {
  const { frontendPolicyViolations } = await import("./frontend-boundary.js");
  const files: Record<string, string> = { "ui.ts": 'import "./helper.js";', "helper.ts": 'export * from "./wrapper.js";', "wrapper.ts": 'void import("./model-invocation.js");' };
  const resolve = (specifier: string) => specifier.replace("./", "").replace(/\.js$/, ".ts");
  expect(frontendPolicyViolations(["ui.ts"], file => files[file], resolve)).toHaveLength(1);
  files["wrapper.ts"] = 'import "./agent-service.js";';
  expect(frontendPolicyViolations(["ui.ts"], file => files[file], resolve)).toEqual([]);
});
it("enforces the dependency boundary through all adapter helper modules", async () => {
  const { frontendPolicyViolations } = await import("./frontend-boundary.js");
  const path = await import("node:path");
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const entries = ["src/cli.ts", "src/cli-agent-transport.ts", "desktop/electron/main.ts", "desktop/core/service.ts"].map(file => path.resolve(file));
  const violations = frontendPolicyViolations(entries, ts.sys.readFile, (specifier, from) => {
    const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
    return resolved && !resolved.isExternalLibraryImport ? resolved.resolvedFileName : undefined;
  });
  expect(violations).toEqual([]);
});
