import path from "node:path";
import ts from "typescript";

/** Traverse adapters, stopping at explicitly approved application boundaries. */
export function frontendPolicyViolations(entries: string[], read: (file: string) => string | undefined, resolve: (specifier: string, from: string) => string | undefined): string[] {
  const boundaries = new Set(["agent-service", "learning-application", "agent-model-factory", "pi-application-client", "provider-registry", "conversation-routing"]);
  const forbidden = new Set(["learning-context", "conversation-context", "learning-agent-profile", "teaching-prompts", "teaching-dialogue", "model-invocation", "assistant-runtime"]);
  const visited = new Set<string>(), failures: string[] = [];
  const visitFile = (file: string, chain: string[]) => {
    const name = path.basename(file).replace(/\.[cm]?tsx?$/, "");
    if (forbidden.has(name)) { failures.push([...chain, file].join(" -> ")); return; }
    if (boundaries.has(name) || visited.has(file)) return;
    visited.add(file); const content = read(file); if (content === undefined) return;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const dependency = (specifier: string) => { const next = resolve(specifier, file); if (next) visitFile(next, [...chain, file]); };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ["PiCodexClient", "DeepSeekClient", "LearningContextBuilder"].includes(node.expression.text)) failures.push(`${file}: new ${node.expression.text}`);
      ts.forEachChild(node, visit);
    }; visit(source);
  };
  entries.forEach(file => visitFile(file, [])); return failures;
}
