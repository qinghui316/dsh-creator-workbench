import ts from "typescript";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

export function checkDependencies(root, { built = true } = {}) {
  const source = resolve(root, "src");
  const files = [];
  const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.[cm]?tsx?$/.test(path) && !path.endsWith(".d.ts")) files.push(path);
  } };
  walk(source);
  const graph = new Map(); const nodeEdges = new Set(); const errors = [];
  const label = (file) => relative(root, file).replaceAll("\\", "/");
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const edges = [];
    const add = (specifier) => {
      if (isBuiltin(specifier)) nodeEdges.add(file);
      if (!specifier.startsWith(".")) return;
      const target = resolve(dirname(file), specifier);
      const resolved = [target, `${target}.ts`, `${target}.tsx`, resolve(target, "index.ts")].find((p) => files.includes(p));
      if (resolved) edges.push(resolved);
      else if (!/\.(css|png|svg)$/.test(target)) errors.push(`Unresolved local dependency: ${label(file)} -> ${specifier}`);
    };
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
        const bindings = clause?.namedBindings;
        const allTypes = clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly))
          || (ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly))));
        if (!allTypes) add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
      else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) add(node.moduleReference.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(ast); graph.set(file, edges);
  }
  const seen = new Set(); const visiting = new Set();
  const cycles = (file, chain) => {
    if (visiting.has(file)) { errors.push(`Runtime cycle: ${[...chain, file].map(label).join(" -> ")}`); return; }
    if (seen.has(file)) return;
    visiting.add(file); for (const child of graph.get(file) ?? []) cycles(child, [...chain, file]);
    visiting.delete(file); seen.add(file);
  };
  for (const file of files) cycles(file, []);
  const closure = (entry) => { const result = new Set(); const stack = [entry]; while (stack.length) { const file = stack.pop(); if (result.has(file)) continue; result.add(file); stack.push(...graph.get(file) ?? []); } return result; };
  for (const file of files.filter((f) => label(f).startsWith("src/client/"))) {
    for (const child of closure(file)) if (nodeEdges.has(child)) errors.push(`Client reaches Node: ${label(file)} -> ${label(child)}`);
  }
  for (const pure of ["projectView.ts", "types.ts", "platforms.ts", "publishRules.ts", "videoSelection.ts", "articleMarkdown.ts", "covers/types.ts", "covers/schemas.ts"]) {
    for (const child of closure(resolve(source, pure))) if (nodeEdges.has(child) || label(child).startsWith("src/client/") || /\/(service|index|backgroundJobs)\.ts$/.test(label(child))) errors.push(`Shared logic crosses boundary: ${pure} -> ${label(child)}`);
  }
  const client = resolve(root, "lib/client.js");
  if (built && existsSync(client) && /(?:require\s*\(|from\s*|import\s*\()\s*["'](?:node:|fs["'/]|path["'/]|child_process["'])/.test(readFileSync(client, "utf8"))) errors.push("Built client contains a Node dependency");
  return [...new Set(errors)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkDependencies(process.cwd());
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Dependency boundaries passed: no runtime cycles, client-to-Node imports, or reverse shared dependencies.");
}
