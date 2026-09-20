import type {
  ContextMemoryConfiguration,
  ContextRecallMetrics,
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
  EnterpriseTeamSummary,
  EnterpriseWorkspaceBinding,
  ExperienceCandidateSummary,
  ExperienceEvidenceSummary,
  ExperienceMethodSummary,
  ExperienceResult,
  MemoryDiffSummary,
  MemoryEntrySummary,
  MemoryPrivacyMode,
  MemoryScope,
  RecallFeedbackKind,
  SharedExperienceDetail,
  SharedExperienceSearchItem,
  SharedSopDetail,
  SharedSopSearchItem
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
  localResourceRecallLimit: number;
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
  method: ExperienceMethodSummary;
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
  "context.recall.feedback": { id: string; feedback: RecallFeedbackKind; sessionId?: string };
  "context.recall.metrics": Record<string, never>;
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
  "sop.shared.search": { query: string };
  "sop.shared.get": { id: string };
  "enterprise.identity.get": { refresh?: boolean };
  "enterprise.auth.begin": Record<string, never>;
  "enterprise.auth.poll": { authorizationId: string };
  "enterprise.auth.disconnect": Record<string, never>;
  "enterprise.team.list": Record<string, never>;
  "enterprise.project.list": { teamId: string };
  "enterprise.knowledge.sync": { teamId: string; projectId?: string; maxPages?: number };
  "enterprise.knowledge.index": { teamId: string; projectId?: string };
  "enterprise.workspace.get": { teamId: string };
  "enterprise.workspace.bind": { teamId: string; enterpriseProjectId: string };
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
  "context.recall.feedback": { id: string; feedback: RecallFeedbackKind; recordedAt: number };
  "context.recall.metrics": ContextRecallMetrics;
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
  "sop.shared.search": { items: SharedSopSearchItem[]; total: number };
  "sop.shared.get": SharedSopDetail;
  "enterprise.identity.get": EnterpriseIdentityStatus;
  "enterprise.auth.begin": EnterpriseDeviceAuthorization;
  "enterprise.auth.poll": EnterpriseIdentityStatus;
  "enterprise.auth.disconnect": EnterpriseIdentityStatus;
  "enterprise.team.list": { items: EnterpriseTeamSummary[]; total: number };
  "enterprise.project.list": { items: EnterpriseProjectSummary[]; total: number };
  "enterprise.knowledge.sync": { progress: { epoch: string | null; cursor: string }; pages: number; headCursor: string };
  "enterprise.knowledge.index": { state: "published-local"; snapshot: { epoch: string; cursor: string } };
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
  "context.commitCompleted": { operationId: string; sessionId: string; diff?: MemoryDiffSummary;
    outcome?: "retained" | "empty" | "skipped" | "extracted" | "extraction-failed" | "unconfirmed" };
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
