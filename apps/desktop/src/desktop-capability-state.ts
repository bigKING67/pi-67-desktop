import type { DesktopIntegrationStatus } from "@pi67/protocol";

export const INTEGRATION_STATE_SCHEMA = "pi67.desktop-integration-state.v2";
const LEGACY_INTEGRATION_STATE_SCHEMA = "pi67.desktop-integration-state.v1";

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
  verifiedAt?: number;
  verifiedPackageIdentity?: string;
  registry?: string;
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
    || !isOptionalTimestamp(value.verifiedAt)
    || (value.verifiedPackageIdentity !== undefined && (
      typeof value.verifiedPackageIdentity !== "string"
      || !/^[0-9A-Za-z.+-]{1,100}:[a-f0-9]{40}$/u.test(value.verifiedPackageIdentity)
    ))
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
    ...(typeof value.verifiedAt === "number" ? { verifiedAt: value.verifiedAt } : {}),
    ...(typeof value.verifiedPackageIdentity === "string"
      ? { verifiedPackageIdentity: value.verifiedPackageIdentity }
      : {}),
    ...(typeof value.registry === "string" ? { registry: value.registry } : {})
  };
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,99}$/u.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
