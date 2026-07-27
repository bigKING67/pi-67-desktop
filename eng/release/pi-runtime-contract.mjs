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

  const overrides = readWorkspaceOverrides(workspaceSource);
  for (const name of PI_RUNTIME_DEPENDENCIES) {
    const overrideVersion = overrides.get(name);
    if (!isExactVersion(overrideVersion)) {
      failures.push(`pnpm-workspace.yaml overrides.${name} must be an exact version, found ${String(overrideVersion)}`);
      continue;
    }
    const packageVersion = packageVersions.get(name);
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

function readWorkspaceOverrides(source) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^overrides:\s*(?:#.*)?$/u.test(line));
  if (start < 0) return new Map();

  const overrides = new Map();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const match = /^\s+(['"]?)([^'":]+)\1:\s*(['"]?)([^'"\s#]+)\3\s*(?:#.*)?$/u.exec(line);
    if (match) overrides.set(match[2], match[4]);
  }
  return overrides;
}
