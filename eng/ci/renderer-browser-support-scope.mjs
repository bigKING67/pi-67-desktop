import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export const RENDERER_BROWSER_SUPPORT_PATHS = new Set([
  "tests/e2e/pi67-composer-draft-test-control.ts",
  "tests/e2e/pi67-context-file-fixture.ts",
  "tests/e2e/pi67-extension-catalog-fixture.ts",
  "tests/e2e/pi67-lark-command-fixture.ts",
  "tests/e2e/pi67-provider-configuration-command-fixture.ts",
  "tests/e2e/pi67-provider-configuration-snapshot-fixture.ts",
  "tests/e2e/pi67-renderer-agent-input-fixture.ts",
  "tests/e2e/pi67-renderer-agent-installation.ts",
  "tests/e2e/pi67-renderer-asset-fixture.ts",
  "tests/e2e/pi67-renderer-command-fixture.ts",
  "tests/e2e/pi67-renderer-controls.ts",
  "tests/e2e/pi67-renderer-desktop-attachment-bridge.ts",
  "tests/e2e/pi67-renderer-desktop-bridge-contract.ts",
  "tests/e2e/pi67-renderer-desktop-bridge.ts",
  "tests/e2e/pi67-renderer-desktop-capability-bridge.ts",
  "tests/e2e/pi67-renderer-desktop-repository-bridge.ts",
  "tests/e2e/pi67-renderer-desktop-shutdown-bridge.ts",
  "tests/e2e/pi67-renderer-fixture-types.ts",
  "tests/e2e/pi67-renderer-fixture.ts",
  "tests/e2e/pi67-renderer-inspector-command-fixture.ts",
  "tests/e2e/pi67-renderer-operation-fixture.ts",
  "tests/e2e/pi67-renderer-package-settings-fixture.ts",
  "tests/e2e/pi67-renderer-payload-sanitizer.ts",
  "tests/e2e/pi67-renderer-scenario-commands.ts",
  "tests/e2e/pi67-renderer-session-fixture.ts",
  "tests/e2e/pi67-renderer-snapshot-fixture.ts",
  "tests/e2e/pi67-renderer-system-fixtures.ts",
  "tests/e2e/pi67-runtime-diagnostics-fixture.ts",
  "tests/e2e/pi67-session-catalog-fixture.ts",
  "tests/e2e/pi67-session-catalog-model-fixture.ts",
  "tests/e2e/renderer-composer-geometry.ts",
  "tests/e2e/renderer-workbench-test-fixture.ts"
]);

export function isRendererBrowserSupportPath(path) {
  return RENDERER_BROWSER_SUPPORT_PATHS.has(path);
}

export function verifyRendererBrowserSupportGraph(cwd = repositoryRoot) {
  const tracked = execFileSync("git", ["ls-files", "tests/e2e/*.ts"], {
    cwd,
    encoding: "utf8"
  }).split(/\r?\n/u).filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "tests/e2e/*.ts"], {
    cwd,
    encoding: "utf8"
  }).split(/\r?\n/u).filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];
  const sources = new Map(files.map((path) => [path, readFileSync(resolve(cwd, path), "utf8")]));
  const violations = rendererBrowserSupportGraphViolations(sources);
  if (violations.length > 0) {
    throw new Error(`Renderer-only E2E support scope is invalid:\n${violations.join("\n")}`);
  }
}

export function rendererBrowserSupportGraphViolations(sources) {
  const files = new Set(sources.keys());
  const missing = [...RENDERER_BROWSER_SUPPORT_PATHS].filter((path) => !files.has(path));
  const nativeRoots = [...files].filter(isNativeElectronSpec);
  const rendererRoots = [...files].filter((path) => /\/renderer(?:-[a-z-]+)?\.spec\.ts$/u.test(path));
  const nativeReachable = reachableFiles(nativeRoots, sources);
  const rendererReachable = reachableFiles(rendererRoots, sources);
  return [
    ...missing.map((path) => `allowlisted support file is missing: ${path}`),
    ...[...RENDERER_BROWSER_SUPPORT_PATHS]
      .filter((path) => nativeReachable.has(path))
      .map((path) => `native Electron spec reaches Renderer-only support: ${path}`),
    ...[...RENDERER_BROWSER_SUPPORT_PATHS]
      .filter((path) => files.has(path) && !rendererReachable.has(path))
      .map((path) => `allowlisted support is not reachable from a Renderer spec: ${path}`)
  ];
}

function reachableFiles(roots, sources) {
  const reachable = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const dependency of relativeTypeScriptImports(current, sources)) {
      if (reachable.has(dependency)) continue;
      reachable.add(dependency);
      queue.push(dependency);
    }
  }
  return reachable;
}

function relativeTypeScriptImports(importer, sources) {
  const source = sources.get(importer) ?? "";
  const specifiers = [...source.matchAll(/(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/gu)]
    .map((match) => match[1]);
  return specifiers.map((specifier) => resolveSourcePath(importer, specifier, sources)).filter(Boolean);
}

function resolveSourcePath(importer, specifier, sources) {
  const candidate = posix.normalize(posix.join(dirname(importer), specifier));
  const stems = candidate.endsWith(".js") ? [candidate.slice(0, -3)] : [candidate];
  for (const stem of stems) {
    for (const suffix of [".ts", ".test.ts", "/index.ts"]) {
      const path = `${stem}${suffix}`;
      if (sources.has(path)) return path;
    }
  }
  return undefined;
}

function isNativeElectronSpec(path) {
  return /\/electron(?:-[a-z-]+)?\.spec\.ts$/u.test(path)
    || path.endsWith("/multi-workspace-electron.spec.ts");
}
