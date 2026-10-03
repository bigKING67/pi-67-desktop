import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PI_RUNTIME_DEPENDENCIES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent"
];
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export async function readPiRuntimeContract(root) {
  const [packageJsonSource, workspaceSource] = await Promise.all([
    readFile(join(root, "packages/pi-runtime/package.json"), "utf8"),
    readFile(join(root, "pnpm-workspace.yaml"), "utf8")
  ]);
  return validatePiRuntimeContract(JSON.parse(packageJsonSource), workspaceSource);
}

export function validatePiRuntimeContract(packageJson, workspaceSource) {
  const failures = [];
  const dependencies = packageJson?.dependencies ?? {};
  const packageVersions = new Map();

  for (const name of PI_RUNTIME_DEPENDENCIES) {
    const version = dependencies[name];
    if (!isExactVersion(version)) {
      failures.push(`packages/pi-runtime/package.json dependencies.${name} must be an exact version, found ${String(version)}`);
      continue;
    }
    packageVersions.set(name, version);
  }

  const distinctPackageVersions = new Set(packageVersions.values());
  if (packageVersions.size === PI_RUNTIME_DEPENDENCIES.length && distinctPackageVersions.size !== 1) {
    failures.push("Pi core, AI, and coding-agent package versions must match");
  }

  if (packageVersions.get("@earendil-works/pi-coding-agent") === "1.0.0"
    && readWorkspaceEntries(workspaceSource, "patchedDependencies").get("@earendil-works/pi-coding-agent@1.0.0")
      !== "patches/@earendil-works__pi-coding-agent@1.0.0.patch") {
    failures.push("Pi 1.0.0 requires the locked native MCP host/lifecycle patch");
  }

  const overrides = readWorkspaceEntries(workspaceSource, "overrides");
  for (const name of [...PI_RUNTIME_DEPENDENCIES, "@earendil-works/pi-tui"]) {
    const overrideVersion = overrides.get(name);
    if (!isExactVersion(overrideVersion)) {
      failures.push(`pnpm-workspace.yaml overrides.${name} must be an exact version, found ${String(overrideVersion)}`);
      continue;
    }
    const packageVersion = packageVersions.get(name) ?? packageVersions.get("@earendil-works/pi-coding-agent");
    if (packageVersion && overrideVersion !== packageVersion) {
      failures.push(`pnpm-workspace.yaml overrides.${name} must match packages/pi-runtime/package.json (${packageVersion})`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Invalid Pi runtime release contract:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  const runtimeVersion = packageVersions.get("@earendil-works/pi-coding-agent");
  return {
    runtimeVersion,
    runtimeSpecifier: `@earendil-works/pi-coding-agent@${runtimeVersion}`
  };
}

function isExactVersion(value) {
  return typeof value === "string" && EXACT_VERSION.test(value);
}

function readWorkspaceEntries(source, section) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.replace(/\s*(?:#.*)?$/u, "") === `${section}:`);
  if (start < 0) return new Map();

  const overrides = new Map();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const match = /^\s+(['"]?)([^'":]+)\1:\s*(['"]?)([^'"\s#]+)\3\s*(?:#.*)?$/u.exec(line);
    if (match) overrides.set(match[2], match[4]);
  }
  return overrides;
}
