import { satisfies, valid } from "semver";

import {
  EXTENSION_ADAPTER_LIMITS,
  type ExtensionAdapterManifest
} from "./manifest.js";
import {
  isValidExtensionPackageName,
  isValidExtensionSurfaceName,
  parseExtensionAdapterManifest
} from "./manifest-validator.js";
import { createExtensionAdapterRegistry } from "./registry.js";

export const EXTENSION_ADAPTER_CONFORMANCE_SCHEMA_VERSION = 2 as const;

export const EXTENSION_ADAPTER_CONFORMANCE_LIMITS = Object.freeze({
  licenseCharacters: 120,
  packageIntegrityCharacters: 256,
  sourceRepositoryCharacters: 512,
  sourcePathCharacters: 512,
  sourcePaths: 16,
  sourceCommitCharacters: 64
});

const SOURCE_REPOSITORY_PATTERN = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u;
const PACKAGE_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

export interface ExtensionAdapterConformanceEvidence {
  readonly schemaVersion: typeof EXTENSION_ADAPTER_CONFORMANCE_SCHEMA_VERSION;
  readonly adapterId: string;
  readonly package: string;
  readonly installedVersion: string;
  readonly packageIntegrity: string;
  readonly license: string;
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly sourcePaths: readonly string[];
  readonly commands: readonly string[];
  readonly tools: readonly string[];
}

export interface ExtensionAdapterConformanceBundle {
  readonly manifest: unknown;
  readonly evidence: unknown;
}

export interface ConformingExtensionAdapter {
  readonly manifest: ExtensionAdapterManifest;
  readonly evidence: ExtensionAdapterConformanceEvidence;
}

export interface ExtensionAdapterConformanceInventory {
  readonly records: readonly ConformingExtensionAdapter[];
  readonly manifests: readonly ExtensionAdapterManifest[];
}

export class ExtensionAdapterConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionAdapterConformanceError";
  }
}

export function createExtensionAdapterConformanceInventory(
  inputs: readonly ExtensionAdapterConformanceBundle[]
): ExtensionAdapterConformanceInventory {
  if (inputs.length > EXTENSION_ADAPTER_LIMITS.manifests) {
    throw new ExtensionAdapterConformanceError(
      `conformance inventory cannot exceed ${EXTENSION_ADAPTER_LIMITS.manifests} records`
    );
  }
  const records = Object.freeze(inputs.map((input) => verifyExtensionAdapterConformance(input)));
  const manifests = Object.freeze(records.map((record) => record.manifest));

  // Reuse the production registry's duplicate-id and overlapping-range checks.
  createExtensionAdapterRegistry(manifests);

  return Object.freeze({ records, manifests });
}

export function verifyExtensionAdapterConformance(
  input: ExtensionAdapterConformanceBundle
): ConformingExtensionAdapter {
  if (!isPlainRecord(input)) throw new ExtensionAdapterConformanceError("bundle must be a plain object");
  assertExactKeys(input, ["manifest", "evidence"], "bundle");

  const manifest = parseExtensionAdapterManifest(input.manifest);
  const evidence = parseConformanceEvidence(input.evidence);
  if (evidence.adapterId !== manifest.id) {
    throw new ExtensionAdapterConformanceError("evidence adapterId does not match manifest id");
  }
  if (evidence.package !== manifest.package) {
    throw new ExtensionAdapterConformanceError("evidence package does not match manifest package");
  }
  if (!satisfies(evidence.installedVersion, manifest.versionRange)) {
    throw new ExtensionAdapterConformanceError("evidence installedVersion does not satisfy manifest versionRange");
  }

  assertObservedSurfaces("command", Object.keys(manifest.commands), evidence.commands);
  assertObservedSurfaces("tool", Object.keys(manifest.tools), evidence.tools);
  return Object.freeze({ manifest, evidence });
}

function parseConformanceEvidence(input: unknown): ExtensionAdapterConformanceEvidence {
  if (!isPlainRecord(input)) throw new ExtensionAdapterConformanceError("evidence must be a plain object");
  assertExactKeys(input, [
    "schemaVersion",
    "adapterId",
    "package",
    "installedVersion",
    "packageIntegrity",
    "license",
    "sourceRepository",
    "sourceCommit",
    "sourcePaths",
    "commands",
    "tools"
  ], "evidence");
  if (input.schemaVersion !== EXTENSION_ADAPTER_CONFORMANCE_SCHEMA_VERSION) {
    throw new ExtensionAdapterConformanceError("unsupported evidence schemaVersion");
  }

  const adapterId = readBoundedString(input.adapterId, "evidence.adapterId", EXTENSION_ADAPTER_LIMITS.adapterIdCharacters);
  const packageName = readBoundedString(
    input.package,
    "evidence.package",
    EXTENSION_ADAPTER_LIMITS.packageNameCharacters
  );
  if (!isValidExtensionPackageName(packageName)) {
    throw new ExtensionAdapterConformanceError("evidence package is not a canonical package name");
  }
  const installedVersion = readBoundedString(
    input.installedVersion,
    "evidence.installedVersion",
    EXTENSION_ADAPTER_LIMITS.versionRangeCharacters
  );
  if (valid(installedVersion) !== installedVersion) {
    throw new ExtensionAdapterConformanceError("evidence installedVersion must be canonical SemVer");
  }
  const packageIntegrity = readBoundedString(
    input.packageIntegrity,
    "evidence.packageIntegrity",
    EXTENSION_ADAPTER_CONFORMANCE_LIMITS.packageIntegrityCharacters
  );
  if (!PACKAGE_INTEGRITY_PATTERN.test(packageIntegrity)) {
    throw new ExtensionAdapterConformanceError("evidence packageIntegrity must be an npm sha512 integrity value");
  }
  const license = readBoundedString(
    input.license,
    "evidence.license",
    EXTENSION_ADAPTER_CONFORMANCE_LIMITS.licenseCharacters
  );
  const sourceRepository = readSourceRepository(input.sourceRepository);
  const sourceCommit = readSourceCommit(input.sourceCommit);
  const sourcePaths = readSourcePaths(input.sourcePaths);
  const commands = readSurfaceNames(input.commands, "evidence.commands", EXTENSION_ADAPTER_LIMITS.commands);
  const tools = readSurfaceNames(input.tools, "evidence.tools", EXTENSION_ADAPTER_LIMITS.tools);

  return Object.freeze({
    schemaVersion: EXTENSION_ADAPTER_CONFORMANCE_SCHEMA_VERSION,
    adapterId,
    package: packageName,
    installedVersion,
    packageIntegrity,
    license,
    sourceRepository,
    sourceCommit,
    sourcePaths,
    commands,
    tools
  });
}

function readSourceRepository(value: unknown): string {
  const repository = readBoundedString(
    value,
    "evidence.sourceRepository",
    EXTENSION_ADAPTER_CONFORMANCE_LIMITS.sourceRepositoryCharacters
  );
  if (!SOURCE_REPOSITORY_PATTERN.test(repository)) {
    throw new ExtensionAdapterConformanceError("evidence sourceRepository must be a canonical HTTPS repository URL");
  }
  return repository;
}

function readSourceCommit(value: unknown): string {
  const commit = readBoundedString(
    value,
    "evidence.sourceCommit",
    EXTENSION_ADAPTER_CONFORMANCE_LIMITS.sourceCommitCharacters
  );
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit)) {
    throw new ExtensionAdapterConformanceError("evidence sourceCommit must be a full lowercase Git object id");
  }
  return commit;
}

function readSourcePaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > EXTENSION_ADAPTER_CONFORMANCE_LIMITS.sourcePaths) {
    throw new ExtensionAdapterConformanceError(
      `evidence.sourcePaths must contain 1-${EXTENSION_ADAPTER_CONFORMANCE_LIMITS.sourcePaths} paths`
    );
  }
  const paths = new Set<string>();
  for (const item of value) {
    const path = readSourcePath(item);
    if (paths.has(path)) {
      throw new ExtensionAdapterConformanceError("evidence.sourcePaths contains a duplicate path");
    }
    paths.add(path);
  }
  return Object.freeze([...paths]);
}

function readSourcePath(value: unknown): string {
  const path = readBoundedString(
    value,
    "evidence.sourcePaths[]",
    EXTENSION_ADAPTER_CONFORMANCE_LIMITS.sourcePathCharacters
  );
  const segments = path.split("/");
  if (
    path.startsWith("/")
    || path.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ExtensionAdapterConformanceError("evidence sourcePaths must contain canonical repository-relative paths");
  }
  return path;
}

function readSurfaceNames(value: unknown, path: string, limit: number): readonly string[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new ExtensionAdapterConformanceError(`${path} must be an array with at most ${limit} entries`);
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !isValidExtensionSurfaceName(item)) {
      throw new ExtensionAdapterConformanceError(`${path} contains an invalid surface name`);
    }
    if (unique.has(item)) throw new ExtensionAdapterConformanceError(`${path} contains a duplicate surface name`);
    unique.add(item);
  }
  return Object.freeze([...unique]);
}

function assertObservedSurfaces(
  kind: "command" | "tool",
  declared: readonly string[],
  observed: readonly string[]
): void {
  const observedNames = new Set(observed);
  const missing = declared.filter((name) => !observedNames.has(name));
  if (missing.length > 0) {
    throw new ExtensionAdapterConformanceError(
      `manifest declares unobserved ${kind} surfaces: ${missing.join(", ")}`
    );
  }
}

function readBoundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ExtensionAdapterConformanceError(`${path} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new ExtensionAdapterConformanceError(`${path} contains a symbol field`);
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ExtensionAdapterConformanceError(`${path}.${key} must be an enumerable data field`);
    }
    if (!allowedKeys.has(key)) throw new ExtensionAdapterConformanceError(`${path} contains unknown field ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) throw new ExtensionAdapterConformanceError(`${path} is missing field ${key}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
