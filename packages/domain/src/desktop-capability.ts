export type DesktopCapabilityOrigin = "first-party" | "third-party" | "external";
export type DesktopCapabilityResourceType = "extension" | "skill" | "prompt" | "rule" | "integration";

export interface DesktopCapabilityPackageSummary {
  id: string;
  displayName: string;
  origin: DesktopCapabilityOrigin;
  bundled: boolean;
  defaultEnabled: boolean;
  version: string;
  commit: string;
  resourceTypes: DesktopCapabilityResourceType[];
  installed: boolean;
}

export interface DesktopRecommendedPackage {
  id: string;
  source: string;
  recommendedVersion?: string;
  minimumCommit?: string;
}

export interface DesktopManagedContextStatus {
  rules: "installed" | "unavailable";
  agents: "installed" | "user-owned" | "unavailable";
}

export interface DesktopIntegrationStatus {
  id: "browser67";
  displayName: string;
  bundled: boolean;
  dependencyState: "not-prepared" | "prepared" | "failed";
  doctorState: "not-checked" | "degraded" | "ready" | "failed";
  detail?: string;
  preparedAt?: number;
  checkedAt?: number;
  registry?: string;
}

export interface DesktopCapabilitySnapshot {
  phase: "initializing" | "ready" | "degraded" | "error";
  catalogVersion?: string;
  packages: DesktopCapabilityPackageSummary[];
  recommendedExternal: DesktopRecommendedPackage[];
  managedContext: DesktopManagedContextStatus;
  integrations: DesktopIntegrationStatus[];
  detail?: string;
}
