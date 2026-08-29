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

export interface DesktopBundledExtensionSummary {
  id: string;
  displayName: string;
  description: string;
  packageId: string;
  packageDisplayName: string;
  version: string;
  installed: boolean;
}

export interface DesktopBundledSkillSummary {
  id: string;
  displayName: string;
  description: string;
  packageId: string;
  packageDisplayName: string;
  version: string;
  installed: boolean;
}

export type DesktopBundledSkillSuiteVersionSource =
  | "unversioned"
  | "skill-pack"
  | "capability-package"
  | "multiple-sources";

export type DesktopBundledSkillSuiteUpdatePolicy =
  | "hybrid"
  | "capability-package"
  | "source-specific";

export type DesktopBundledSkillSuiteUpdateManager =
  | "lark-cli"
  | "pi67-skill-pack-registry"
  | "desktop-capability"
  | "source-specific";

export interface DesktopBundledSkillSuiteSummary {
  id: string;
  displayName: string;
  description: string;
  versionSource: DesktopBundledSkillSuiteVersionSource;
  bundledVersion?: string;
  upstream?: string;
  sourceCommit?: string;
  updatePolicy: DesktopBundledSkillSuiteUpdatePolicy;
  updateManager: DesktopBundledSkillSuiteUpdateManager;
  independentUpdateState: "available" | "planned" | "not-applicable";
  skills: DesktopBundledSkillSummary[];
}

export interface DesktopRecommendedPackage {
  id: string;
  source: string;
  recommendedVersion?: string;
  minimumCommit?: string;
  installPolicy: "prompt-once" | "user-initiated";
  admissionPolicy: "known-baseline-or-user-approval" | "user-approval";
  baselineContentSha256?: string;
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
  extensionState: "not-prepared" | "prepared" | "reload-required" | "connected" | "failed";
  doctorState: "not-checked" | "degraded" | "ready" | "failed";
  verificationState: "never" | "verified" | "stale";
  availableBrowsers: Array<"chrome" | "edge">;
  detail?: string;
  preparedAt?: number;
  checkedAt?: number;
  extensionPreparedAt?: number;
  extensionCheckedAt?: number;
  verifiedAt?: number;
  registry?: string;
}

export interface DesktopCapabilitySnapshot {
  phase: "initializing" | "ready" | "degraded" | "error";
  catalogVersion?: string;
  packages: DesktopCapabilityPackageSummary[];
  bundledExtensions: DesktopBundledExtensionSummary[];
  bundledSkills: DesktopBundledSkillSummary[];
  bundledSkillSuites: DesktopBundledSkillSuiteSummary[];
  recommendedExternal: DesktopRecommendedPackage[];
  managedContext: DesktopManagedContextStatus;
  integrations: DesktopIntegrationStatus[];
  detail?: string;
}
