import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  protocolDocumentationViolations,
  rendererSessionInstallationViolations
} from "./architecture-rules.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoots = [join(root, "apps"), join(root, "packages")];
const files = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat();
const fileSet = new Set(files);
const workspacePackages = await discoverWorkspacePackages(fileSet);
const packageEntries = new Map(
  workspacePackages
    .filter((item) => item.sourceEntry)
    .map((item) => [item.name, item.sourceEntry])
);
const graph = new Map(files.map((file) => [file, []]));
const violations = [];
let dependencyCount = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  violations.push(...rendererSessionInstallationViolations(toRepoPath(file), source));
  for (const specifier of parseImports(source)) {
    dependencyCount += 1;
    checkBoundary(file, specifier, violations);
    const target = resolveSourceImport(file, specifier, fileSet);
    if (target) graph.get(file)?.push(target);
  }
}

checkManifestBoundaries(workspacePackages, violations);
violations.push(...protocolDocumentationViolations(
  await readFile(join(root, "packages/protocol/src/protocol-version.ts"), "utf8"),
  await readFile(join(root, "docs/architecture/processes-and-protocol.md"), "utf8")
));

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
    if (
      [".ts", ".tsx", ".mts", ".cts"].includes(extname(entry.name))
      && !/\.(?:test|spec)\.[cm]?tsx?$/u.test(entry.name)
    ) output.push(path);
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
    specifier.startsWith("node:")
    || specifier === "electron"
    || specifier === "react"
    || specifier === "react-dom"
    || specifier.startsWith("@earendil-works/")
    || specifier === "@pi67/pi-runtime"
  )) fail("protocol must remain runtime-neutral");
  if (path.startsWith("packages/extension-compat/") && (
    specifier.startsWith("node:")
    || specifier === "electron"
    || specifier === "react"
    || specifier === "react-dom"
    || specifier.startsWith("@earendil-works/")
    || specifier.startsWith("@pi67/")
  )) fail("extension compatibility manifests must remain runtime-neutral and data-only");
  if (path.startsWith("packages/pi-runtime/") && (specifier === "electron" || specifier.startsWith("apps/"))) {
    fail("Pi runtime cannot depend on Electron or an application");
  }
  if (!path.startsWith("packages/pi-runtime/") && specifier.startsWith("@earendil-works/")) {
    fail("only packages/pi-runtime may import the Pi SDK runtime");
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

async function discoverWorkspacePackages(sourceFiles) {
  const entries = [];
  for (const kind of ["apps", "packages"]) {
    const parent = join(root, kind);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(parent, entry.name);
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      const sourceEntry = [join(directory, "src/index.ts"), join(directory, "src/index.tsx")]
        .find((candidate) => sourceFiles.has(candidate));
      entries.push({
        name: manifest.name,
        kind,
        directory,
        sourceEntry,
        runtimeDependencies: {
          ...manifest.dependencies,
          ...manifest.peerDependencies
        },
        dependencies: {
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies
        }
      });
    }
  }
  return entries;
}

function checkManifestBoundaries(packages, output) {
  const byName = new Map(packages.map((item) => [item.name, item]));
  for (const owner of packages) {
    for (const dependencyName of Object.keys(owner.dependencies)) {
      const dependency = byName.get(dependencyName);
      if (!dependency) continue;
      if (owner.kind === "packages" && dependency.kind === "apps") {
        output.push(`${toRepoPath(owner.directory)}/package.json -> ${dependencyName}: packages cannot depend on applications`);
      }
    }

    for (const dependencyName of Object.keys(owner.runtimeDependencies)) {
      const fail = (reason) => output.push(
        `${toRepoPath(owner.directory)}/package.json -> ${dependencyName}: ${reason}`
      );
      if (owner.name === "@pi67/domain") fail("domain must remain dependency-free");
      if (owner.name === "@pi67/protocol" && (
        dependencyName === "electron"
        || dependencyName === "react"
        || dependencyName === "react-dom"
        || dependencyName === "@pi67/pi-runtime"
        || dependencyName.startsWith("@earendil-works/")
      )) fail("protocol must remain runtime-neutral");
      if (owner.name === "@pi67/extension-compat" && (
        dependencyName === "electron"
        || dependencyName === "react"
        || dependencyName === "react-dom"
        || dependencyName.startsWith("@earendil-works/")
        || dependencyName.startsWith("@pi67/")
      )) fail("extension compatibility manifests must remain runtime-neutral and data-only");
      if (owner.name !== "@pi67/pi-runtime" && dependencyName.startsWith("@earendil-works/")) {
        fail("only packages/pi-runtime may own Pi SDK runtime dependencies");
      }
      if (owner.name === "@pi67/renderer" && (
        dependencyName === "electron"
        || dependencyName === "@pi67/pi-runtime"
        || dependencyName.startsWith("@earendil-works/")
      )) fail("renderer cannot depend on privileged runtimes");
      if (owner.name === "@pi67/desktop" && (
        dependencyName === "@pi67/domain"
        || dependencyName === "@pi67/pi-runtime"
        || dependencyName.startsWith("@earendil-works/")
      )) fail("Electron Main must depend only on protocol-neutral application contracts");
    }
  }
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
