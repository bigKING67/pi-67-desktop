export type SkillPackManager = "lark-cli" | "pi67-desktop";
export type SkillPackManagerStatus = "ready" | "missing";
export type SkillPackUpdateOwner = "managed-pack" | "desktop";
export type SkillPackUpdateStatus =
  | "not-installed"
  | "not-checked"
  | "sync-pending"
  | "current"
  | "update-available"
  | "application-managed"
  | "modified"
  | "unavailable";
export type SkillPackLocalState = "clean" | "modified" | "unknown";
export type SkillPackProvenance = "verified" | "unverified";
export type SkillPackEffectiveSource = "bundled" | "managed";

export const LARK_CLI_SKILL_PACK_ID = "lark-cli-global";

export interface SkillPackEntry {
  id: string;
  suiteId: string;
  displayName: string;
  description: string;
  manager: SkillPackManager;
  managerStatus: SkillPackManagerStatus;
  updateOwner: SkillPackUpdateOwner;
  updateStatus: SkillPackUpdateStatus;
  localState: SkillPackLocalState;
  provenance: SkillPackProvenance;
  installed: boolean;
  installedSkillCount: number;
  skillIds: string[];
  canInstall: boolean;
  canUpdate: boolean;
  effectiveSource: SkillPackEffectiveSource;
  canRestore: boolean;
  baselineVersion?: string;
  installedVersion?: string;
  installedSkillVersion?: string;
  latestVersion?: string;
  registryCommit?: string;
  source?: string;
  detail?: string;
}

export interface SkillPackListResult {
  items: SkillPackEntry[];
  total: number;
  checkedAt?: number;
}

export interface SkillPackMutationResult extends SkillPackListResult {
  changed: boolean;
}
