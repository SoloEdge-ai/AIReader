import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, sep } from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures: string[] = [];
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}
function dependencies(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const walk = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      imports.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      imports.push(node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      else failures.push(`${relative(root, file)}: dynamic module paths bypass dependency checking`);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return imports;
}
const inside = (path: string, directory: string) => path === directory || path.startsWith(directory + sep);
for (const name of ["protocol", "workspace-engine"]) {
  const directory = resolve(root, "packages", name, "src");
  for (const file of files(directory)) {
    for (const imported of dependencies(file)) {
      const target = resolve(dirname(file), imported);
      const allowed = imported.startsWith(".")
        ? inside(target, directory) || (name === "workspace-engine" && inside(target, resolve(root, "packages/protocol/src")))
        : name === "protocol" && imported === "zod";
      if (!allowed) failures.push(`${relative(root, file)}: forbidden dependency ${imported}`);
      if (name === "protocol" && imported.startsWith(".") &&
          (target === resolve(directory, "index") || target === directory || target === resolve(directory, "index.ts")))
        failures.push(`${relative(root, file)}: domain modules must not import their barrel`);
    }
  }
}
// Current documentation is a maintained entry graph; historical records keep
// their original links and do not define today's implementation contract.
for (const directory of [resolve(root, "docs")]) {
  const walkDocs = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "archive") continue;
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) { walkDocs(file); continue; }
      if (!file.endsWith(".md")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^\s)]+)\)/g)) {
        const link = match[1].split("#")[0];
        if (!link || /^[a-z]+:/i.test(link)) continue;
        if (!existsSync(resolve(dir, decodeURIComponent(link))))
          failures.push(`${relative(root, file)}: missing documentation target ${link}`);
      }
    }
  };
  walkDocs(directory);
}
if (failures.length) throw new Error(failures.join("\n"));
console.log("Protocol/engine dependency boundaries and current documentation links passed");
