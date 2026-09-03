import type { ExperienceCandidateSummary } from "@pi67/domain";

export function isCandidateSummary(value: ExperienceCandidateSummary): boolean {
  return isLegacyCandidateSummary(value)
    && Array.isArray(value.sourceCases)
    && value.sourceCases.length <= 64
    && value.sourceCases.every((item) => (
      item !== null
      && text(item.id, 512)
      && item.source === "pi-session-commit"
      && ["success", "partial", "failed", "rolled-back"].includes(item.result)
      && Number.isSafeInteger(item.evidenceCount)
      && item.evidenceCount >= 0
      && item.evidenceCount <= 64
      && text(item.workspaceId, 512)
      && Number.isSafeInteger(item.capturedAt)
      && item.capturedAt >= 0
    ))
    && isExperienceMethod(value.method);
}

export function isLegacyCandidateSummary(value: ExperienceCandidateSummary): boolean {
  return typeof value === "object"
    && value !== null
    && text(value.id, 512)
    && text(value.workspaceId, 512)
    && text(value.taskType, 256)
    && text(value.title, 512)
    && text(value.problem, 8_192)
    && text(value.strategy, 16_384)
    && ["success", "partial", "failed", "rolled-back"].includes(value.result)
    && ["private", "candidate", "submitted", "validated", "shared", "rejected", "revoked"].includes(value.status)
    && ["private", "project", "team", "company"].includes(value.sensitivity)
    && ["pending", "passed", "failed"].includes(value.redactionStatus)
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.updatedAt)
    && Array.isArray(value.applicableWhen)
    && Array.isArray(value.notApplicableWhen)
    && Array.isArray(value.evidence)
    && value.evidence.length <= 64
    && value.evidence.every((item) => (
      item !== null
      && ["test", "tool-result", "user-confirmation", "artifact"].includes(item.kind)
      && text(item.label, 512)
      && text(item.reference, 2_048)
      && Number.isSafeInteger(item.verifiedAt)
    ));
}

export function isCandidateSource(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return text(source.commitSubmissionId, 512)
    && hash(source.workspaceFingerprint)
    && hash(source.sourceSessionIdHash)
    && hash(source.sessionContentHash)
    && text(source.experienceUri, 4_096)
    && hash(source.experienceUriHash)
    && hash(source.experienceContentHash);
}

function isExperienceMethod(value: ExperienceCandidateSummary["method"]): boolean {
  return typeof value === "object"
    && value !== null
    && textArray(value.preconditions, 32, 2_048)
    && textArray(value.steps, 32, 2_048)
    && textArray(value.tools, 32, 512)
    && textArray(value.validationGates, 32, 2_048)
    && textArray(value.completionCriteria, 32, 2_048)
    && textArray(value.failureModes, 32, 2_048)
    && typeof value.rollback === "string"
    && value.rollback.length <= 8_192;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function textArray(value: unknown, maximumItems: number, maximumLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => text(item, maximumLength));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
