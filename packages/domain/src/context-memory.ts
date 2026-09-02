export const MEMORY_PRIVACY_MODES = [
  "full-learning",
  "private-learning",
  "read-only",
  "off"
] as const;

export type MemoryPrivacyMode = (typeof MEMORY_PRIVACY_MODES)[number];

export type ContextOwner = "pi67-openviking" | "pi-default-compaction" | "none";
export type ContextRuntimeHealth = "healthy" | "degraded" | "unavailable" | "disabled" | "conflict";
export type MemoryScope = "user" | "workspace" | "team" | "company";
export type RecallSource = "private-memory" | "private-experience" | "shared-experience" | "resource";

export interface MemoryPrivacyCapabilities {
  recall: boolean;
  writePrivateMemory: boolean;
  createTeamCandidate: boolean;
}

export interface ContextTakeoverConfiguration {
  enabled: boolean;
  tokenThreshold: number;
  keepRecentTurns: number;
}

export interface ContextMemoryConfiguration {
  revision: string;
  enabled: boolean;
  endpoint: string;
  enterpriseGatewayEndpoint: string;
  defaultPrivacyMode: MemoryPrivacyMode;
  recallTokenBudget: number;
  scoreThreshold: number;
  commitTokenThreshold: number;
  captureAssistantTurns: boolean;
  captureToolResults: false;
  actorScopeOnly: true;
  privateExperienceLimit: number;
  sharedExperienceLimit: number;
  healthTimeoutMs: number;
  recallTimeoutMs: number;
  takeover: ContextTakeoverConfiguration;
}

export interface ContextOwnerLock {
  sessionId: string;
  owner: ContextOwner;
  lockedAt: number;
  reason: "session-created" | "session-opened" | "fallback" | "memory-conflict";
}

export interface ContextRuntimeStatus {
  provider: "openviking";
  version?: string;
  health: ContextRuntimeHealth;
  owner: ContextOwner;
  effectivePrivacyMode: MemoryPrivacyMode;
  endpoint: string;
  configured: boolean;
  conflictExtensions: string[];
  lastCheckedAt: number;
  latencyMs?: number;
  detail?: string;
}

export interface ContextSessionStatus {
  sessionId: string;
  owner: ContextOwner;
  privacyMode: MemoryPrivacyMode;
  capturedTurns: number;
  pendingTokens: number;
  liveTailTurns: number;
  takeoverActive: boolean;
  lastCommitAt?: number;
}

export interface ContextRecallItem {
  id: string;
  title: string;
  summary: string;
  source: RecallSource;
  scope: MemoryScope;
  score: number;
  createdAt: number;
  reason: string;
  expiresAt?: number;
  workspaceId?: string;
}

export interface MemoryEntrySummary {
  id: string;
  title: string;
  summary: string;
  scope: MemoryScope;
  createdAt: number;
  updatedAt: number;
  workspaceId?: string;
}

export interface MemoryDiffSummary {
  commitId: string;
  added: number;
  updated: number;
  merged: number;
  deleted: number;
  committedAt: number;
}

export type ExperienceCandidateStatus =
  | "private"
  | "candidate"
  | "submitted"
  | "validated"
  | "shared"
  | "rejected"
  | "revoked";

export type ExperienceResult = "success" | "partial" | "failed" | "rolled-back";

export interface ExperienceEvidenceSummary {
  kind: "test" | "tool-result" | "user-confirmation" | "artifact";
  label: string;
  reference: string;
  verifiedAt: number;
}

export interface ExperienceCandidateSummary {
  id: string;
  taskType: string;
  title: string;
  problem: string;
  strategy: string;
  result: ExperienceResult;
  confidence: number;
  status: ExperienceCandidateStatus;
  sensitivity: "private" | "project" | "team" | "company";
  applicableWhen: string[];
  notApplicableWhen: string[];
  evidence: ExperienceEvidenceSummary[];
  redactionStatus: "pending" | "passed" | "failed";
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  enterpriseCandidateId?: string;
  submittedAt?: number;
}

export interface SharedExperienceSearchItem {
  id: string;
  projectId: string;
  title: string;
  taskType: string;
  summary: string;
  score: number;
  applicableWhen: string[];
  notApplicableWhen: string[];
  externalRevision: string;
  publishedAt: number;
}

export interface SharedExperienceDetail {
  id: string;
  projectId: string;
  title: string;
  taskType: string;
  problem: string;
  strategy: string;
  result: ExperienceResult;
  confidence: number;
  sensitivity: "project" | "team" | "company";
  applicableWhen: string[];
  notApplicableWhen: string[];
  evidence: ExperienceEvidenceSummary[];
  externalRevision: string;
  publishedAt: number;
}

export interface EnterpriseIdentityStatus {
  state: "signed-out" | "pending" | "signed-in" | "expired";
  accountId?: string;
  userId?: string;
  displayName?: string;
  expiresAt?: number;
}

export interface EnterpriseProjectSummary {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  bindingCount: number;
  candidateCount: number;
  sharedAssetCount: number;
  updatedAt: number;
}

export interface EnterpriseWorkspaceBinding {
  state: "unbound" | "pending" | "bound" | "revoked";
  workspaceId: string;
  enterpriseProjectId?: string;
  enterpriseProjectName?: string;
  accountId?: string;
  boundAt?: number;
}

export interface EnterpriseCandidateEligibilityInput {
  identity: EnterpriseIdentityStatus;
  workspace: EnterpriseWorkspaceBinding;
  privacyMode: MemoryPrivacyMode;
  workspaceTrusted: boolean;
  result: ExperienceResult;
  evidenceCount: number;
  redactionStatus: ExperienceCandidateSummary["redactionStatus"];
  sensitivity: ExperienceCandidateSummary["sensitivity"];
}

export interface EnterpriseCandidateEligibility {
  eligible: boolean;
  reasons: Array<
    | "signed-out"
    | "workspace-untrusted"
    | "workspace-unbound"
    | "privacy-mode"
    | "result-unverified"
    | "missing-evidence"
    | "redaction-incomplete"
    | "private-sensitivity"
  >;
}

export const DEFAULT_CONTEXT_MEMORY_CONFIGURATION: Omit<ContextMemoryConfiguration, "revision"> = {
  enabled: true,
  endpoint: "http://127.0.0.1:1933",
  enterpriseGatewayEndpoint: "",
  defaultPrivacyMode: "private-learning",
  recallTokenBudget: 1_200,
  scoreThreshold: 0.35,
  commitTokenThreshold: 20_000,
  captureAssistantTurns: true,
  captureToolResults: false,
  actorScopeOnly: true,
  privateExperienceLimit: 1,
  sharedExperienceLimit: 1,
  healthTimeoutMs: 800,
  recallTimeoutMs: 1_000,
  takeover: {
    enabled: true,
    tokenThreshold: 30_000,
    keepRecentTurns: 3
  }
};

export function memoryPrivacyCapabilities(mode: MemoryPrivacyMode): MemoryPrivacyCapabilities {
  switch (mode) {
    case "full-learning":
      return { recall: true, writePrivateMemory: true, createTeamCandidate: true };
    case "private-learning":
      return { recall: true, writePrivateMemory: true, createTeamCandidate: false };
    case "read-only":
      return { recall: true, writePrivateMemory: false, createTeamCandidate: false };
    case "off":
      return { recall: false, writePrivateMemory: false, createTeamCandidate: false };
  }
}

export function resolveContextOwner(input: {
  openVikingEnabled: boolean;
  openVikingAvailable: boolean;
  conflictingOwners: readonly string[];
}): ContextOwner {
  if (input.conflictingOwners.length > 0) return "pi-default-compaction";
  if (input.openVikingEnabled && input.openVikingAvailable) return "pi67-openviking";
  return "pi-default-compaction";
}

export function contextOwnerTransitionAllowed(
  current: ContextOwnerLock | undefined,
  nextOwner: ContextOwner,
  sessionId: string
): boolean {
  return current === undefined || current.sessionId !== sessionId || current.owner === nextOwner;
}

export function enterpriseCandidateEligibility(
  input: EnterpriseCandidateEligibilityInput
): EnterpriseCandidateEligibility {
  const reasons: EnterpriseCandidateEligibility["reasons"] = [];
  if (input.identity.state !== "signed-in") reasons.push("signed-out");
  if (!input.workspaceTrusted) reasons.push("workspace-untrusted");
  if (input.workspace.state !== "bound") reasons.push("workspace-unbound");
  if (!memoryPrivacyCapabilities(input.privacyMode).createTeamCandidate) reasons.push("privacy-mode");
  if (input.result !== "success") reasons.push("result-unverified");
  if (input.evidenceCount === 0) reasons.push("missing-evidence");
  if (input.redactionStatus !== "passed") reasons.push("redaction-incomplete");
  if (input.sensitivity === "private") reasons.push("private-sensitivity");
  return { eligible: reasons.length === 0, reasons };
}
