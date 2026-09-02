import type {
  ContextMemoryConfiguration,
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
  EnterpriseWorkspaceBinding,
  ExperienceCandidateSummary,
  ExperienceEvidenceSummary,
  ExperienceResult,
  MemoryDiffSummary,
  MemoryEntrySummary,
  MemoryPrivacyMode,
  MemoryScope,
  SharedExperienceDetail,
  SharedExperienceSearchItem
} from "@pi67/domain";

export interface ContextMemoryConfigurationUpdate {
  expectedRevision: string;
  enabled: boolean;
  endpoint: string;
  enterpriseGatewayEndpoint: string;
  defaultPrivacyMode: MemoryPrivacyMode;
  recallTokenBudget: number;
  scoreThreshold: number;
  commitTokenThreshold: number;
  captureAssistantTurns: boolean;
  privateExperienceLimit: number;
  sharedExperienceLimit: number;
  takeover: {
    enabled: boolean;
    tokenThreshold: number;
    keepRecentTurns: number;
  };
}

export interface ExperienceCandidateReview {
  id: string;
  expectedUpdatedAt: number;
  taskType: string;
  title: string;
  problem: string;
  strategy: string;
  result: ExperienceResult;
  confidence: number;
  sensitivity: "project" | "team" | "company";
  applicableWhen: string[];
  notApplicableWhen: string[];
  evidence: ExperienceEvidenceSummary[];
  confirmOutcome: true;
  confirmRedaction: true;
}

export interface ContextDoctorResult {
  checkedAt: number;
  status: ContextRuntimeStatus;
  effectiveConfiguration: ContextMemoryConfiguration;
  checks: Array<{
    id: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }>;
}

export interface ContextAsyncOperationAccepted {
  kind: "accepted";
  operationId: string;
  cancellable: false;
}

export interface ForgetPreview {
  previewToken: string;
  entry: MemoryEntrySummary;
  effects: string[];
  expiresAt: number;
}

export interface EnterpriseDeviceAuthorization {
  authorizationId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface ContextMemoryCommandPayloads {
  "context.status.get": Record<string, never>;
  "context.config.get": Record<string, never>;
  "context.config.update": ContextMemoryConfigurationUpdate;
  "context.runtime.doctor": { probeRemote?: boolean };
  "context.session.get": { sessionId: string };
  "context.session.commit": { submissionId: string; sessionId: string };
  "context.recall.list": { sessionId?: string; limit?: number };
  "memory.search": { query: string; scope?: MemoryScope; limit?: number };
  "memory.get": { id: string };
  "memory.forget.preview": { id: string };
  "memory.forget.confirm": { submissionId: string; previewToken: string };
  "experience.private.list": { status?: ExperienceCandidateSummary["status"]; limit?: number };
  "experience.candidate.get": { id: string };
  "experience.candidate.review": ExperienceCandidateReview;
  "experience.candidate.promote": { submissionId: string; id: string };
  "experience.candidate.reject": { id: string; reason: string };
  "experience.shared.search": { query: string; limit?: number };
  "experience.shared.get": { id: string };
  "enterprise.identity.get": Record<string, never>;
  "enterprise.auth.begin": Record<string, never>;
  "enterprise.auth.poll": { authorizationId: string };
  "enterprise.auth.disconnect": Record<string, never>;
  "enterprise.project.list": Record<string, never>;
  "enterprise.workspace.get": Record<string, never>;
  "enterprise.workspace.bind": { enterpriseProjectId: string };
  "enterprise.workspace.unbind": Record<string, never>;
}

export interface ContextMemoryCommandResults {
  "context.status.get": ContextRuntimeStatus;
  "context.config.get": ContextMemoryConfiguration;
  "context.config.update": ContextMemoryConfiguration;
  "context.runtime.doctor": ContextDoctorResult;
  "context.session.get": ContextSessionStatus;
  "context.session.commit": ContextAsyncOperationAccepted;
  "context.recall.list": { items: ContextRecallItem[]; total: number };
  "memory.search": { items: MemoryEntrySummary[]; total: number };
  "memory.get": MemoryEntrySummary;
  "memory.forget.preview": ForgetPreview;
  "memory.forget.confirm": ContextAsyncOperationAccepted;
  "experience.private.list": { items: ExperienceCandidateSummary[]; total: number };
  "experience.candidate.get": ExperienceCandidateSummary;
  "experience.candidate.review": ExperienceCandidateSummary;
  "experience.candidate.promote": ContextAsyncOperationAccepted;
  "experience.candidate.reject": ExperienceCandidateSummary;
  "experience.shared.search": { items: SharedExperienceSearchItem[]; total: number };
  "experience.shared.get": SharedExperienceDetail;
  "enterprise.identity.get": EnterpriseIdentityStatus;
  "enterprise.auth.begin": EnterpriseDeviceAuthorization;
  "enterprise.auth.poll": EnterpriseIdentityStatus;
  "enterprise.auth.disconnect": EnterpriseIdentityStatus;
  "enterprise.project.list": { items: EnterpriseProjectSummary[]; total: number };
  "enterprise.workspace.get": EnterpriseWorkspaceBinding;
  "enterprise.workspace.bind": EnterpriseWorkspaceBinding;
  "enterprise.workspace.unbind": EnterpriseWorkspaceBinding;
}

export interface ContextMemoryEventPayloads {
  "context.healthChanged": ContextRuntimeStatus;
  "context.ownerLocked": { sessionId: string; owner: ContextRuntimeStatus["owner"]; lockedAt: number };
  "context.configChanged": ContextMemoryConfiguration;
  "context.recallStarted": { sessionId: string; startedAt: number };
  "context.recallCompleted": { sessionId: string; completedAt: number; count: number; degraded: boolean };
  "context.captureQueued": { sessionId: string; turnId: string; queuedAt: number };
  "context.captureFailed": { sessionId: string; turnId: string; failedAt: number; detail: string };
  "context.commitCompleted": { operationId: string; sessionId: string; diff?: MemoryDiffSummary };
  "context.commitFailed": { operationId: string; sessionId: string; detail: string };
  "memory.diffAvailable": MemoryDiffSummary;
  "memory.forgetCompleted": { operationId: string; memoryId: string; completedAt: number };
  "experience.candidateCreated": ExperienceCandidateSummary;
  "experience.candidateAssemblyFailed": {
    sourceSessionIdHash: string;
    failedAt: number;
    detail: string;
  };
  "experience.candidateValidated": ExperienceCandidateSummary;
  "experience.candidatePromoted": { operationId: string; candidate: ExperienceCandidateSummary };
  "experience.candidatePromotionFailed": {
    operationId: string;
    candidateId: string;
    failedAt: number;
    detail: string;
  };
  "experience.candidateRejected": ExperienceCandidateSummary;
  "enterprise.authChanged": EnterpriseIdentityStatus;
  "enterprise.workspaceBindingChanged": EnterpriseWorkspaceBinding;
}
