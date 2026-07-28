export type ExtensionPackageScope = "global" | "project";

export interface ExtensionPackageEntry {
  source: string;
  scope: ExtensionPackageScope;
  enabled: boolean;
  filtered: boolean;
  installed: boolean;
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
}
