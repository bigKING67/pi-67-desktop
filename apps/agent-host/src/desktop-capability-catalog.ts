import { isAbsolute } from "node:path";

const MANIFEST_SCHEMA = "pi67.desktop-capabilities.v1";
const CATALOG_SCHEMA = "pi67.capability-catalog.v1";
const MAX_CAPABILITY_PACKAGES = 32;

interface CapabilityManifestPackage {
  id: string;
  treeSha256: string;
}

export interface CapabilityManifest {
  schema: typeof MANIFEST_SCHEMA;
  catalogVersion: string;
  packages: CapabilityManifestPackage[];
}

interface CapabilityCatalogEntry {
  id: string;
  displayName: string;
  packagePath: string;
  resourceTypes: string[];
}

interface CapabilityRecommendedPackage {
  id: string;
  source: string;
  recommendedVersion?: string;
  minimumCommit?: string;
  installPolicy: "prompt-once" | "user-initiated";
  admissionPolicy: "known-baseline-or-user-approval" | "user-approval";
  baselineContentSha256?: string;
}

export interface CapabilityCatalog {
  schema: typeof CATALOG_SCHEMA;
  catalogVersion: string;
  entries: CapabilityCatalogEntry[];
  recommendedExternal: CapabilityRecommendedPackage[];
}

export function parseCapabilityManifest(value: unknown): CapabilityManifest | undefined {
  if (!isRecord(value) || value.schema !== MANIFEST_SCHEMA || !isVersion(value.catalogVersion)) return undefined;
  if (!Array.isArray(value.packages) || value.packages.length > MAX_CAPABILITY_PACKAGES) return undefined;
  const packages: CapabilityManifestPackage[] = [];
  for (const item of value.packages) {
    if (!isRecord(item) || !isId(item.id) || !isSha256(item.treeSha256)) return undefined;
    packages.push({ id: item.id, treeSha256: item.treeSha256 });
  }
  if (new Set(packages.map((entry) => entry.id)).size !== packages.length) return undefined;
  return { schema: MANIFEST_SCHEMA, catalogVersion: value.catalogVersion, packages };
}

export function parseCapabilityCatalog(value: unknown): CapabilityCatalog | undefined {
  if (!isRecord(value) || value.schema !== CATALOG_SCHEMA || !isVersion(value.catalogVersion)) return undefined;
  if (!Array.isArray(value.entries) || value.entries.length > MAX_CAPABILITY_PACKAGES) return undefined;
  const entries: CapabilityCatalogEntry[] = [];
  for (const item of value.entries) {
    if (
      !isRecord(item)
      || !isId(item.id)
      || typeof item.displayName !== "string"
      || item.displayName.length === 0
      || item.displayName.length > 200
      || !isContainedRelativePath(item.packagePath)
      || !Array.isArray(item.resourceTypes)
      || item.resourceTypes.some((type) => typeof type !== "string" || type.length === 0 || type.length > 40)
    ) return undefined;
    entries.push({
      id: item.id,
      displayName: item.displayName,
      packagePath: item.packagePath,
      resourceTypes: [...item.resourceTypes]
    });
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return undefined;
  if (!Array.isArray(value.recommendedExternal) || value.recommendedExternal.length > 64) return undefined;
  const recommendedExternal = value.recommendedExternal.map(parseRecommendedPackage);
  if (recommendedExternal.some((entry) => entry === undefined)) return undefined;
  const recommended = recommendedExternal as CapabilityRecommendedPackage[];
  if (new Set(recommended.map((entry) => entry.id)).size !== recommended.length) return undefined;
  return {
    schema: CATALOG_SCHEMA,
    catalogVersion: value.catalogVersion,
    entries,
    recommendedExternal: recommended
  };
}

function parseRecommendedPackage(value: unknown): CapabilityRecommendedPackage | undefined {
  if (
    !isRecord(value)
    || !isId(value.id)
    || typeof value.source !== "string"
    || !value.source.startsWith("npm:") && !value.source.startsWith("https://")
    || value.source.length > 4_096
    || (value.recommendedVersion !== undefined && !isVersion(value.recommendedVersion))
    || (value.minimumCommit !== undefined && (
      typeof value.minimumCommit !== "string" || !/^[0-9a-f]{40}$/u.test(value.minimumCommit)
    ))
    || (value.installPolicy !== "prompt-once" && value.installPolicy !== "user-initiated")
    || (
      value.admissionPolicy !== "known-baseline-or-user-approval"
      && value.admissionPolicy !== "user-approval"
    )
    || (value.baselineContentSha256 !== undefined && !isSha256(value.baselineContentSha256))
    || (
      value.admissionPolicy === "known-baseline-or-user-approval"
      && (value.baselineContentSha256 === undefined || value.recommendedVersion === undefined)
    )
  ) return undefined;
  return {
    id: value.id,
    source: value.source,
    ...(value.recommendedVersion === undefined ? {} : { recommendedVersion: value.recommendedVersion }),
    ...(value.minimumCommit === undefined ? {} : { minimumCommit: value.minimumCommit }),
    installPolicy: value.installPolicy,
    admissionPolicy: value.admissionPolicy,
    ...(value.baselineContentSha256 === undefined
      ? {}
      : { baselineContentSha256: value.baselineContentSha256 })
  };
}

export function isContainedRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && !value.includes("\0")
    && !isAbsolute(value)
    && !value.split(/[\\/]/u).includes("..");
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && !value.includes("\0");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
