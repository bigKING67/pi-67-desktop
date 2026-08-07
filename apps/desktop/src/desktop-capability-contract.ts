import { readFile, stat } from "node:fs/promises";
import type {
  DesktopCapabilityOrigin,
  DesktopCapabilityPackageSummary,
  DesktopCapabilityResourceType,
  DesktopCapabilitySnapshot,
  DesktopBundledSkillSuiteSummary,
  DesktopIntegrationStatus,
  DesktopRecommendedPackage
} from "@pi67/protocol";

const MAX_METADATA_BYTES = 1_000_000;
export const INTEGRATION_STATE_SCHEMA = "pi67.desktop-integration-state.v2";
const LEGACY_INTEGRATION_STATE_SCHEMA = "pi67.desktop-integration-state.v1";

export interface BundledCapabilityCatalog {
  catalogVersion: string;
  entries: Array<Omit<DesktopCapabilityPackageSummary, "installed"> & {
    packagePath: string;
    bundledExtensions: Array<{ id: string; displayName: string }>;
    bundledSkills: Array<{ id: string; displayName: string; description: string }>;
  }>;
  bundledSkillSuites: Array<Omit<DesktopBundledSkillSuiteSummary, "skills"> & {
    members: Array<{ packageId: string; skillId: string }>;
  }>;
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
  extensionState: DesktopIntegrationStatus["extensionState"];
  doctorState: DesktopIntegrationStatus["doctorState"];
  detail?: string;
  preparedAt?: number;
  checkedAt?: number;
  extensionPreparedAt?: number;
  extensionCheckedAt?: number;
  registry?: string;
}

export function snapshotFromCatalog(
  catalog: BundledCapabilityCatalog,
  state: ManagedCapabilityState | undefined,
  browser: DesktopIntegrationStatus
): DesktopCapabilitySnapshot {
  const installed = new Map(state?.packages.map((entry) => [entry.id, entry.installed]) ?? []);
  const bundledSkills = catalog.entries.flatMap((entry) => entry.bundledSkills.map((skill) => ({
    ...skill,
    packageId: entry.id,
    packageDisplayName: entry.displayName,
    version: entry.version,
    installed: installed.get(entry.id) === true
  })));
  const bundledSkillsByKey = new Map(bundledSkills.map((skill) => [
    bundledSkillKey(skill.packageId, skill.id),
    skill
  ]));
  return {
    phase: "initializing",
    catalogVersion: catalog.catalogVersion,
    packages: catalog.entries.map(({
      packagePath: _packagePath,
      bundledExtensions: _bundledExtensions,
      bundledSkills: _bundledSkills,
      ...entry
    }) => ({ ...entry, installed: installed.get(entry.id) === true })),
    bundledExtensions: catalog.entries.flatMap((entry) => entry.bundledExtensions.map((extension) => ({
      ...extension,
      packageId: entry.id,
      packageDisplayName: entry.displayName,
      version: entry.version,
      installed: installed.get(entry.id) === true
    }))),
    bundledSkills,
    bundledSkillSuites: catalog.bundledSkillSuites.map(({ members, ...suite }) => ({
      ...suite,
      skills: members.map((member) => {
        const skill = bundledSkillsByKey.get(bundledSkillKey(member.packageId, member.skillId));
        if (!skill) throw new Error("Desktop bundled Skill suite member is unavailable.");
        return skill;
      })
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
    bundledExtensions: [],
    bundledSkills: [],
    bundledSkillSuites: [],
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
    const bundledExtensions = item.bundledExtensions === undefined
      ? []
      : parseBundledExtensions(item.bundledExtensions);
    const bundledSkills = item.bundledSkills === undefined
      ? []
      : parseBundledSkills(item.bundledSkills);
    return {
      id: item.id,
      displayName: item.displayName,
      origin: item.origin,
      bundled: true,
      defaultEnabled: item.defaultEnabled,
      version: item.version,
      commit: item.commit,
      packagePath: item.packagePath,
      resourceTypes,
      bundledExtensions,
      bundledSkills
    };
  });
  const recommendedExternal = Array.isArray(value.recommendedExternal)
    ? value.recommendedExternal.map(parseRecommendedPackage)
    : [];
  const bundledSkillSuites = parseBundledSkillSuites(value.bundledSkillSuites, entries);
  return { catalogVersion: value.catalogVersion, entries, bundledSkillSuites, recommendedExternal };
}

function parseBundledExtensions(value: unknown): Array<{ id: string; displayName: string }> {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("Desktop bundled extension entries are invalid.");
  }
  const extensions = value.map((item) => {
    if (
      !isRecord(item)
      || !isId(item.id)
      || typeof item.displayName !== "string"
      || item.displayName.length === 0
      || item.displayName.length > 200
    ) throw new Error("Desktop bundled extension entry is invalid.");
    return { id: item.id, displayName: item.displayName };
  });
  if (new Set(extensions.map((entry) => entry.id)).size !== extensions.length) {
    throw new Error("Desktop bundled extension entries are duplicated.");
  }
  return extensions;
}

function parseBundledSkills(value: unknown): Array<{ id: string; displayName: string; description: string }> {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Desktop bundled skill entries are invalid.");
  }
  const skills = value.map((item) => {
    if (
      !isRecord(item)
      || !isId(item.id)
      || typeof item.displayName !== "string"
      || item.displayName.length === 0
      || item.displayName.length > 200
      || typeof item.description !== "string"
      || item.description.length === 0
      || item.description.length > 2_000
    ) throw new Error("Desktop bundled skill entry is invalid.");
    return { id: item.id, displayName: item.displayName, description: item.description };
  });
  if (new Set(skills.map((entry) => entry.id)).size !== skills.length) {
    throw new Error("Desktop bundled skill entries are duplicated.");
  }
  return skills;
}

function parseBundledSkillSuites(
  value: unknown,
  entries: BundledCapabilityCatalog["entries"]
): BundledCapabilityCatalog["bundledSkillSuites"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Desktop bundled Skill suite entries are invalid.");
  }
  const availableSkills = new Set(entries.flatMap((entry) => (
    entry.bundledSkills.map((skill) => bundledSkillKey(entry.id, skill.id))
  )));
  const assignedSkills = new Set<string>();
  const suites = value.map((item) => {
    if (
      !isRecord(item)
      || !isId(item.id)
      || typeof item.displayName !== "string"
      || item.displayName.length === 0
      || item.displayName.length > 100
      || typeof item.description !== "string"
      || item.description.length === 0
      || item.description.length > 500
      || !isBundledSkillSuiteVersionSource(item.versionSource)
      || !isBundledSkillSuiteVersion(item.versionSource, item.bundledVersion)
      || (item.upstream !== undefined && !isHttpsUrl(item.upstream))
      || (item.sourceCommit !== undefined && !isCommit(item.sourceCommit))
      || !isBundledSkillSuiteUpdatePolicy(item.updatePolicy)
      || !isBundledSkillSuiteUpdateManager(item.updateManager)
      || !isBundledSkillSuiteIndependentUpdateState(item.independentUpdateState)
      || !Array.isArray(item.members)
      || item.members.length === 0
      || item.members.length > 256
    ) throw new Error("Desktop bundled Skill suite entry is invalid.");
    const members = item.members.map((member) => {
      if (!isRecord(member) || !isId(member.packageId) || !isId(member.skillId)) {
        throw new Error("Desktop bundled Skill suite member is invalid.");
      }
      const key = bundledSkillKey(member.packageId, member.skillId);
      if (!availableSkills.has(key) || assignedSkills.has(key)) {
        throw new Error("Desktop bundled Skill suite coverage is invalid.");
      }
      assignedSkills.add(key);
      return { packageId: member.packageId, skillId: member.skillId };
    });
    return {
      id: item.id,
      displayName: item.displayName,
      description: item.description,
      versionSource: item.versionSource,
      ...(typeof item.bundledVersion === "string" ? { bundledVersion: item.bundledVersion } : {}),
      ...(typeof item.upstream === "string" ? { upstream: item.upstream } : {}),
      ...(typeof item.sourceCommit === "string" ? { sourceCommit: item.sourceCommit } : {}),
      updatePolicy: item.updatePolicy,
      updateManager: item.updateManager,
      independentUpdateState: item.independentUpdateState,
      members
    };
  });
  if (
    new Set(suites.map((suite) => suite.id)).size !== suites.length
    || assignedSkills.size !== availableSkills.size
  ) throw new Error("Desktop bundled Skill suite coverage is invalid.");
  return suites;
}

function bundledSkillKey(packageId: string, skillId: string): string {
  return `${packageId}:${skillId}`;
}

function isBundledSkillSuiteVersionSource(value: unknown): value is DesktopBundledSkillSuiteSummary["versionSource"] {
  return ["unversioned", "skill-pack", "capability-package", "multiple-sources"].includes(String(value));
}

function isBundledSkillSuiteVersion(
  source: DesktopBundledSkillSuiteSummary["versionSource"],
  value: unknown
): boolean {
  return source === "skill-pack" || source === "capability-package"
    ? isVersion(value)
    : value === undefined;
}

function isBundledSkillSuiteUpdatePolicy(
  value: unknown
): value is DesktopBundledSkillSuiteSummary["updatePolicy"] {
  return ["hybrid", "capability-package", "source-specific"].includes(String(value));
}

function isBundledSkillSuiteUpdateManager(
  value: unknown
): value is DesktopBundledSkillSuiteSummary["updateManager"] {
  return ["lark-cli", "pi67-skill-pack-registry", "desktop-capability", "source-specific"].includes(String(value));
}

function isBundledSkillSuiteIndependentUpdateState(
  value: unknown
): value is DesktopBundledSkillSuiteSummary["independentUpdateState"] {
  return ["available", "planned", "not-applicable"].includes(String(value));
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
    || (value.schema !== INTEGRATION_STATE_SCHEMA && value.schema !== LEGACY_INTEGRATION_STATE_SCHEMA)
    || !["not-prepared", "prepared", "failed"].includes(String(value.dependencyState))
    || !["not-checked", "degraded", "ready", "failed"].includes(String(value.doctorState))
  ) throw new Error("browser67 integration state is invalid.");
  if (value.schema === LEGACY_INTEGRATION_STATE_SCHEMA) {
    return {
      schema: INTEGRATION_STATE_SCHEMA,
      dependencyState: value.dependencyState as Browser67IntegrationState["dependencyState"],
      extensionState: "not-prepared",
      doctorState: value.doctorState as Browser67IntegrationState["doctorState"],
      ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
      ...(typeof value.preparedAt === "number" ? { preparedAt: value.preparedAt } : {}),
      ...(typeof value.checkedAt === "number" ? { checkedAt: value.checkedAt } : {}),
      ...(typeof value.registry === "string" ? { registry: value.registry } : {})
    };
  }
  if (![
    "not-prepared",
    "prepared",
    "reload-required",
    "connected",
    "failed"
  ].includes(String(value.extensionState))) throw new Error("browser67 integration state is invalid.");
  if (
    (value.detail !== undefined && (typeof value.detail !== "string" || value.detail.length > 500))
    || !isOptionalTimestamp(value.preparedAt)
    || !isOptionalTimestamp(value.checkedAt)
    || !isOptionalTimestamp(value.extensionPreparedAt)
    || !isOptionalTimestamp(value.extensionCheckedAt)
    || (value.registry !== undefined && (typeof value.registry !== "string" || value.registry.length > 2_048))
  ) throw new Error("browser67 integration state is invalid.");
  return {
    schema: INTEGRATION_STATE_SCHEMA,
    dependencyState: value.dependencyState as Browser67IntegrationState["dependencyState"],
    extensionState: value.extensionState as Browser67IntegrationState["extensionState"],
    doctorState: value.doctorState as Browser67IntegrationState["doctorState"],
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
    ...(typeof value.preparedAt === "number" ? { preparedAt: value.preparedAt } : {}),
    ...(typeof value.checkedAt === "number" ? { checkedAt: value.checkedAt } : {}),
    ...(typeof value.extensionPreparedAt === "number" ? { extensionPreparedAt: value.extensionPreparedAt } : {}),
    ...(typeof value.extensionCheckedAt === "number" ? { extensionCheckedAt: value.extensionCheckedAt } : {}),
    ...(typeof value.registry === "string" ? { registry: value.registry } : {})
  };
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
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
  if (value.installPolicy !== "prompt-once" && value.installPolicy !== "user-initiated") {
    throw new Error("Recommended Desktop package install policy is invalid.");
  }
  if (
    value.admissionPolicy !== "known-baseline-or-user-approval"
    && value.admissionPolicy !== "user-approval"
  ) throw new Error("Recommended Desktop package admission policy is invalid.");
  if (value.baselineContentSha256 !== undefined && (
    typeof value.baselineContentSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.baselineContentSha256)
  )) throw new Error("Recommended Desktop package content baseline is invalid.");
  if (
    value.admissionPolicy === "known-baseline-or-user-approval"
    && value.baselineContentSha256 === undefined
  ) throw new Error("Recommended Desktop package content baseline is required.");
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

function isOrigin(value: unknown): value is DesktopCapabilityOrigin {
  return value === "first-party" || value === "third-party" || value === "external";
}

function isResourceType(value: unknown): value is DesktopCapabilityResourceType {
  return value === "extension" || value === "skill" || value === "prompt" || value === "rule" || value === "integration";
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
