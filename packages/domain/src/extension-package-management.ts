export type ExtensionPackageScope = "global" | "project";
export type PackageResourceType = "extension" | "skill" | "prompt" | "theme";
export type PackageSourceKind = "bundled" | "npm" | "git" | "path";
export type CapabilityOrigin = "first-party" | "third-party" | "external";
export type ExtensionPackageTrustState =
  | "builtin-verified"
  | "user-installed-observed"
  | "unverified"
  | "drifted"
  | "unavailable";
export type ExtensionPackageIntegrityReason =
  | "receipt-missing"
  | "install-content-missing"
  | "package-identity-changed"
  | "manifest-changed"
  | "directory-identity-changed"
  | "content-hash-changed"
  | "receipt-invalid"
  | "inspection-limited"
  | "mutation-ambiguous";
export type ExtensionPackageReceiptState = "active" | "removed" | "ambiguous" | "not-applicable";

export interface PackageResourceState {
  type: PackageResourceType;
  enabled: boolean;
}

export interface ExtensionPackageEntry {
  source: string;
  scope: ExtensionPackageScope;
  enabled: boolean;
  filtered: boolean;
  installed: boolean;
  displayName?: string;
  version?: string;
  description?: string;
  sourceKind?: PackageSourceKind;
  origin?: CapabilityOrigin;
  resourceTypes?: PackageResourceType[];
  resourceStates?: PackageResourceState[];
  trustState: ExtensionPackageTrustState;
  trustReason?: ExtensionPackageIntegrityReason;
  trustObservedAt?: number;
  manifestSha256?: string;
  contentSha256?: string;
}

export interface ExtensionPackageUpdate {
  source: string;
  scope: ExtensionPackageScope;
  type: "npm" | "git";
  displayName: string;
}

export interface ExtensionPackageListResult {
  items: ExtensionPackageEntry[];
  total: number;
}

export interface ExtensionPackageUpdatesResult {
  items: ExtensionPackageUpdate[];
  total: number;
}

export interface ExtensionPackageMutationResult extends ExtensionPackageListResult {
  changed: boolean;
  receiptState?: ExtensionPackageReceiptState;
}
