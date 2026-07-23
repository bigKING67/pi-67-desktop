import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoots = [join(root, "apps"), join(root, "packages")];
const packageEntries = new Map([
  ["@pi67/domain", join(root, "packages/domain/src/index.ts")],
  ["@pi67/protocol", join(root, "packages/protocol/src/index.ts")],
  ["@pi67/pi-runtime", join(root, "packages/pi-runtime/src/index.ts")]
]);

const files = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat();
const fileSet = new Set(files);
const graph = new Map(files.map((file) => [file, []]));
const violations = [];
let dependencyCount = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const specifier of parseImports(source)) {
    dependencyCount += 1;
    checkBoundary(file, specifier, violations);
    const target = resolveSourceImport(file, specifier, fileSet);
    if (target) graph.get(file)?.push(target);
  }
}

for (const cycle of findCycles(graph)) {
  violations.push(`circular dependency: ${cycle.map(toRepoPath).join(" -> ")}`);
}

if (violations.length > 0) {
  console.error(`Architecture check failed with ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Architecture check passed: ${files.length} modules, ${dependencyCount} imports, 0 cycles.`);

async function collectSourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dist" && entry.name !== "node_modules") output.push(...await collectSourceFiles(path));
      continue;
    }
    if ([".ts", ".tsx", ".mts", ".cts"].includes(extname(entry.name)) && !entry.name.endsWith(".test.ts")) output.push(path);
  }
  return output;
}

function parseImports(source) {
  const imports = new Set();
  const staticPattern = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [staticPattern, dynamicPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return imports;
}

function checkBoundary(file, specifier, output) {
  const path = toRepoPath(file);
  const fail = (reason) => output.push(`${path} -> ${specifier}: ${reason}`);

  if (specifier.startsWith(".")) {
    const ownerRoot = packageRoot(file);
    const target = resolve(dirname(file), specifier);
    if (relative(ownerRoot, target).startsWith(`..${sep}`) || relative(ownerRoot, target) === "..") {
      fail("relative import escapes its package boundary");
    }
  }
  if (path.startsWith("packages/") && specifier.startsWith("apps/")) fail("packages cannot import applications");
  if (path.startsWith("packages/domain/") && (
    specifier.startsWith("node:")
    || specifier === "electron"
    || specifier.startsWith("@earendil-works/")
    || specifier.startsWith("@pi67/")
  )) fail("domain must remain dependency-free");
  if (path.startsWith("packages/protocol/") && (
    specifier === "electron"
    || specifier.startsWith("@earendil-works/")
    || specifier === "@pi67/pi-runtime"
  )) fail("protocol must remain runtime-neutral");
  if (path.startsWith("packages/pi-runtime/") && (specifier === "electron" || specifier.startsWith("apps/"))) {
    fail("Pi runtime cannot depend on Electron or an application");
  }
  if (path.startsWith("apps/renderer/") && (
    specifier.startsWith("node:")
    || specifier === "electron"
    || specifier.startsWith("@earendil-works/")
    || specifier === "@pi67/pi-runtime"
  )) fail("renderer cannot import privileged runtimes");
  if (path.startsWith("apps/desktop/") && (
    specifier === "@pi67/pi-runtime"
    || specifier === "@pi67/domain"
    || specifier.startsWith("@earendil-works/")
  )) fail("Electron Main must communicate through protocol contracts");
}

function resolveSourceImport(file, specifier, knownFiles) {
  const packageEntry = packageEntries.get(specifier);
  if (packageEntry) return packageEntry;
  if (!specifier.startsWith(".")) return undefined;
  const unresolved = resolve(dirname(file), specifier);
  const candidates = extname(unresolved)
    ? [unresolved.replace(/\.js$/u, ".ts"), unresolved.replace(/\.js$/u, ".tsx"), unresolved]
    : [`${unresolved}.ts`, `${unresolved}.tsx`, join(unresolved, "index.ts")];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

function findCycles(graphValue) {
  const cycles = [];
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const recorded = new Set();

  const visit = (node) => {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const key = [...new Set(cycle)].sort((left, right) => left.localeCompare(right)).join("|");
      if (!recorded.has(key)) {
        recorded.add(key);
        cycles.push(cycle);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of graphValue.get(node) ?? []) visit(target);
    stack.pop();
    active.delete(node);
  };

  for (const node of graphValue.keys()) visit(node);
  return cycles;
}

function toRepoPath(path) {
  return relative(root, path).split(sep).join("/");
}

function packageRoot(file) {
  const path = toRepoPath(file).split("/");
  return join(root, path[0], path[1]);
}
