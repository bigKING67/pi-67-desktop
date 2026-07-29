import { readFile, stat } from "node:fs/promises";
import type {
  DesktopCapabilityOrigin,
  DesktopCapabilityPackageSummary,
  DesktopCapabilityResourceType,
  DesktopCapabilitySnapshot,
  DesktopIntegrationStatus,
  DesktopRecommendedPackage
} from "@pi67/protocol";

const MAX_METADATA_BYTES = 1_000_000;
export const INTEGRATION_STATE_SCHEMA = "pi67.desktop-integration-state.v1";

export interface BundledCapabilityCatalog {
  catalogVersion: string;
  entries: Array<Omit<DesktopCapabilityPackageSummary, "installed"> & { packagePath: string }>;
  recommendedExternal: DesktopRecommendedPackage[];
}

export interface ManagedCapabilityState {
  catalogVersion: string;
  packages: Array<{ id: string; installed: boolean }>;
  rules: "installed" | "unavailable";
  agents: "installed" | "user-owned" | "unavailable";
}

export interface Browser67IntegrationState {
  schema: typeof INTEGRATION_STATE_SCHEMA;
  dependencyState: DesktopIntegrationStatus["dependencyState"];
  doctorState: DesktopIntegrationStatus["doctorState"];
  detail?: string;
  preparedAt?: number;
  checkedAt?: number;
  registry?: string;
}

export function snapshotFromCatalog(
  catalog: BundledCapabilityCatalog,
  state: ManagedCapabilityState | undefined,
  browser: DesktopIntegrationStatus
): DesktopCapabilitySnapshot {
  const installed = new Map(state?.packages.map((entry) => [entry.id, entry.installed]) ?? []);
  return {
    phase: "initializing",
    catalogVersion: catalog.catalogVersion,
    packages: catalog.entries.map(({ packagePath: _packagePath, ...entry }) => ({
      ...entry,
      installed: installed.get(entry.id) === true
    })),
    recommendedExternal: catalog.recommendedExternal,
    managedContext: {
      rules: state?.rules ?? "unavailable",
      agents: state?.agents ?? "unavailable"
    },
    integrations: [browser]
  };
}

export function emptyCapabilitySnapshot(detail: string): DesktopCapabilitySnapshot {
  return {
    phase: "error",
    packages: [],
    recommendedExternal: [],
    managedContext: { rules: "unavailable", agents: "unavailable" },
    integrations: [],
    detail
  };
}

export function parseBundledCatalog(value: unknown): BundledCapabilityCatalog {
  if (!isRecord(value) || value.schema !== "pi67.capability-catalog.v1" || !isVersion(value.catalogVersion)) {
    throw new Error("Desktop capability catalog is invalid.");
  }
  if (!Array.isArray(value.entries) || value.entries.length > 32) throw new Error("Desktop capability entries are invalid.");
  const entries = value.entries.map((item): BundledCapabilityCatalog["entries"][number] => {
    if (
      !isRecord(item)
      || !isId(item.id)
      || typeof item.displayName !== "string"
      || !isOrigin(item.origin)
      || item.bundled !== true
      || typeof item.defaultEnabled !== "boolean"
      || !isVersion(item.version)
      || typeof item.commit !== "string"
      || !/^[0-9a-f]{40}$/u.test(item.commit)
      || typeof item.packagePath !== "string"
      || !Array.isArray(item.resourceTypes)
    ) throw new Error("Desktop capability catalog entry is invalid.");
    const resourceTypes = item.resourceTypes.map((type) => {
      if (!isResourceType(type)) throw new Error("Desktop capability resource type is invalid.");
      return type;
    });
    return {
      id: item.id,
      displayName: item.displayName,
      origin: item.origin,
      bundled: true,
      defaultEnabled: item.defaultEnabled,
      version: item.version,
      commit: item.commit,
      packagePath: item.packagePath,
      resourceTypes
    };
  });
  const recommendedExternal = Array.isArray(value.recommendedExternal)
    ? value.recommendedExternal.map(parseRecommendedPackage)
    : [];
  return { catalogVersion: value.catalogVersion, entries, recommendedExternal };
}

export function parseManagedState(value: unknown): ManagedCapabilityState {
  if (
    !isRecord(value)
    || value.schema !== "pi67.desktop-capability-state.v1"
    || !isVersion(value.catalogVersion)
    || !Array.isArray(value.packages)
    || (value.rules !== "installed" && value.rules !== "unavailable")
    || (value.agents !== "installed" && value.agents !== "user-owned" && value.agents !== "unavailable")
  ) throw new Error("Managed Desktop capability state is invalid.");
  const packages = value.packages.map((item) => {
    if (!isRecord(item) || !isId(item.id) || typeof item.installed !== "boolean") {
      throw new Error("Managed Desktop capability package state is invalid.");
    }
    return { id: item.id, installed: item.installed };
  });
  return { catalogVersion: value.catalogVersion, packages, rules: value.rules, agents: value.agents };
}

export function parseBrowserState(value: unknown): Browser67IntegrationState {
  if (
    !isRecord(value)
    || value.schema !== INTEGRATION_STATE_SCHEMA
    || !["not-prepared", "prepared", "failed"].includes(String(value.dependencyState))
    || !["not-checked", "degraded", "ready", "failed"].includes(String(value.doctorState))
  ) throw new Error("browser67 integration state is invalid.");
  return value as unknown as Browser67IntegrationState;
}

export async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_METADATA_BYTES) throw new Error("Capability metadata is invalid.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 500);
}

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseRecommendedPackage(value: unknown): DesktopRecommendedPackage {
  if (!isRecord(value) || !isId(value.id) || typeof value.source !== "string" || value.source.length > 4_096) {
    throw new Error("Recommended Desktop package entry is invalid.");
  }
  if (value.recommendedVersion !== undefined && !isVersion(value.recommendedVersion)) {
    throw new Error("Recommended Desktop package version is invalid.");
  }
  if (value.minimumCommit !== undefined && (
    typeof value.minimumCommit !== "string" || !/^[0-9a-f]{40}$/u.test(value.minimumCommit)
  )) throw new Error("Recommended Desktop package commit is invalid.");
  return {
    id: value.id,
    source: value.source,
    ...(value.recommendedVersion === undefined ? {} : { recommendedVersion: value.recommendedVersion }),
    ...(value.minimumCommit === undefined ? {} : { minimumCommit: value.minimumCommit })
  };
}

function isOrigin(value: unknown): value is DesktopCapabilityOrigin {
  return value === "first-party" || value === "third-party" || value === "external";
}

function isResourceType(value: unknown): value is DesktopCapabilityResourceType {
  return value === "extension" || value === "skill" || value === "prompt" || value === "rule" || value === "integration";
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
