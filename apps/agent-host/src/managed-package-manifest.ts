import { isAbsolute } from "node:path";

const MANIFEST_SCHEMA = "pi67.managed-npm-bundle.v1";

export const MAX_MANAGED_PACKAGE_TREE_FILES = 50_000;
export const MAX_MANAGED_PACKAGE_TREE_BYTES = 768 * 1024 * 1024;

export interface ManagedPackageEntry {
  id: string;
  packageName: string;
  source: string;
  version: string;
  packageIntegrity: string;
  packagePath: string;
  extensionPaths: string[];
  defaultEnabled: true;
}

export interface ManagedPackageManifest {
  schema: typeof MANIFEST_SCHEMA;
  catalogVersion: string;
  platform: string;
  architecture: string;
  lockfileSha256: string;
  treeSha256: string;
  fileCount: number;
  totalBytes: number;
  packages: ManagedPackageEntry[];
}

export function parseManagedPackageManifest(value: unknown): ManagedPackageManifest {
  if (
    !isRecord(value)
    || value.schema !== MANIFEST_SCHEMA
    || !isVersion(value.catalogVersion)
    || typeof value.platform !== "string"
    || typeof value.architecture !== "string"
    || !isSha256(value.lockfileSha256)
    || !isSha256(value.treeSha256)
    || !Number.isSafeInteger(value.fileCount)
    || (value.fileCount as number) < 1
    || (value.fileCount as number) > MAX_MANAGED_PACKAGE_TREE_FILES
    || !Number.isSafeInteger(value.totalBytes)
    || (value.totalBytes as number) < 1
    || (value.totalBytes as number) > MAX_MANAGED_PACKAGE_TREE_BYTES
    || !Array.isArray(value.packages)
    || value.packages.length === 0
    || value.packages.length > 16
  ) throw new Error("Managed package manifest is invalid.");
  const packages = value.packages.map(parseManagedPackageEntry);
  if (new Set(packages.map((entry) => entry.id)).size !== packages.length) {
    throw new Error("Managed package manifest contains duplicate entries.");
  }
  return {
    schema: MANIFEST_SCHEMA,
    catalogVersion: value.catalogVersion,
    platform: value.platform,
    architecture: value.architecture,
    lockfileSha256: value.lockfileSha256,
    treeSha256: value.treeSha256,
    fileCount: value.fileCount as number,
    totalBytes: value.totalBytes as number,
    packages
  };
}

export function isManagedPackageRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && !value.includes("\0")
    && !isAbsolute(value)
    && !value.split(/[\\/]/u).includes("..");
}

function parseManagedPackageEntry(value: unknown): ManagedPackageEntry {
  if (
    !isRecord(value)
    || !isId(value.id)
    || value.packageName !== value.id
    || value.source !== `npm:${value.packageName}`
    || !isVersion(value.version)
    || typeof value.packageIntegrity !== "string"
    || !value.packageIntegrity.startsWith("sha512-")
    || !isManagedPackageRelativePath(value.packagePath)
    || !Array.isArray(value.extensionPaths)
    || value.extensionPaths.length === 0
    || value.extensionPaths.some((path) => !isManagedPackageRelativePath(path))
    || value.defaultEnabled !== true
  ) throw new Error("Managed package manifest entry is invalid.");
  return {
    id: value.id,
    packageName: value.packageName,
    source: value.source,
    version: value.version,
    packageIntegrity: value.packageIntegrity,
    packagePath: value.packagePath,
    extensionPaths: [...value.extensionPaths] as string[],
    defaultEnabled: true
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && !value.includes("\0");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
