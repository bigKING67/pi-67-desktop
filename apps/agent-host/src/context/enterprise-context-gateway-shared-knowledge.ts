import type {
  SharedExperienceDetail,
  SharedExperienceSearchItem,
  SharedSopDetail,
  SharedSopSearchItem
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedNumber,
  boundedOptionalString,
  boundedString,
  boundedStringArray,
  invalidResponse,
  kebabIdentifier,
  lowercaseSha256,
  optionalExperienceMethod,
  optionalTimestamp,
  parseEvidence,
  parseTimestamp
} from "./enterprise-context-gateway-validation.js";

export function parseSharedExperienceSearchResponse(value: unknown): SharedExperienceSearchItem[] {
  const response = asRecord(value);
  if (!Array.isArray(response.results) || response.results.length > 5) {
    throw invalidResponse("shared.results");
  }
  return response.results.map((item) => {
    const record = asRecord(item);
    assertActiveAsset(record, "experience");
    const content = asRecord(record.content);
    return {
      id: boundedString(record.id, "shared.id"),
      projectId: boundedString(record.projectId, "shared.projectId"),
      title: boundedString(record.title, "shared.title", 512),
      taskType: boundedString(content.taskType, "shared.content.taskType", 256),
      summary: boundedOptionalString(record.summary, "shared.summary", 8_192),
      score: record.score === undefined ? 0 : boundedNumber(record.score, "shared.score", 0, 1),
      applicableWhen: boundedStringArray(content.applicableWhen, "shared.content.applicableWhen"),
      notApplicableWhen: boundedStringArray(
        content.notApplicableWhen,
        "shared.content.notApplicableWhen"
      ),
      externalRevision: lowercaseSha256(record.externalRevision, "shared.externalRevision"),
      publishedAt: parseTimestamp(record.publishedAt, "shared.publishedAt")
    };
  });
}

export function parseSharedExperienceDetail(value: unknown): SharedExperienceDetail {
  const record = asRecord(value);
  assertActiveAsset(record, "experience");
  const content = asRecord(record.content);
  const result = content.result;
  if (result !== "success" && result !== "partial" && result !== "failed" && result !== "rolled-back") {
    throw invalidResponse("shared.result");
  }
  const sensitivity = content.sensitivity;
  if (sensitivity !== "project" && sensitivity !== "team" && sensitivity !== "company") {
    throw invalidResponse("shared.sensitivity");
  }
  if (!Array.isArray(content.evidence) || content.evidence.length > 64) {
    throw invalidResponse("shared.evidence");
  }
  const method = optionalExperienceMethod(content.method);
  return {
    id: boundedString(record.id, "shared.id"),
    projectId: boundedString(record.projectId, "shared.projectId"),
    title: boundedString(record.title, "shared.title", 512),
    taskType: boundedString(content.taskType, "shared.taskType", 256),
    problem: boundedString(content.problem, "shared.problem", 8_192),
    strategy: boundedString(content.strategy, "shared.strategy", 16_384),
    ...(method === undefined ? {} : { method }),
    result,
    confidence: boundedNumber(content.confidence, "shared.confidence", 0, 1),
    sensitivity,
    applicableWhen: boundedStringArray(content.applicableWhen, "shared.applicableWhen"),
    notApplicableWhen: boundedStringArray(content.notApplicableWhen, "shared.notApplicableWhen"),
    evidence: content.evidence.map((item) => {
      const evidence = asRecord(item);
      const kind = evidence.kind;
      if (kind !== "test" && kind !== "tool-result" && kind !== "user-confirmation" && kind !== "artifact") {
        throw invalidResponse("shared.evidence.kind");
      }
      return {
        kind,
        label: boundedString(evidence.label, "shared.evidence.label", 512),
        reference: `sha256:${lowercaseSha256(evidence.hash, "shared.evidence.hash")}`,
        verifiedAt: parseTimestamp(evidence.verifiedAt, "shared.evidence.verifiedAt")
      };
    }),
    externalRevision: lowercaseSha256(record.externalRevision, "shared.externalRevision"),
    publishedAt: parseTimestamp(record.publishedAt, "shared.publishedAt")
  };
}

export function parseSharedSopSearchResponse(value: unknown): SharedSopSearchItem[] {
  const response = asRecord(value);
  if (!Array.isArray(response.results) || response.results.length > 2) {
    throw invalidResponse("sop.results");
  }
  return response.results.map((item) => {
    const record = asRecord(item);
    assertActiveAsset(record, "sop");
    const content = asRecord(record.content);
    const expiresAt = activeSopExpiry(content.expiresAt);
    return {
      id: boundedString(record.id, "sop.id"),
      projectId: boundedString(record.projectId, "sop.projectId"),
      stableKey: kebabIdentifier(content.stableKey, "sop.content.stableKey"),
      semanticVersion: boundedInteger(content.semanticVersion, "sop.content.semanticVersion", 1),
      title: boundedString(record.title, "sop.title", 512),
      taskType: boundedString(content.taskType, "sop.content.taskType", 256),
      summary: boundedOptionalString(record.summary, "sop.summary", 8_192),
      score: record.score === undefined ? 0 : boundedNumber(record.score, "sop.score", 0, 1),
      applicableWhen: boundedStringArray(content.applicableWhen, "sop.content.applicableWhen"),
      notApplicableWhen: boundedStringArray(content.notApplicableWhen, "sop.content.notApplicableWhen"),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      externalRevision: lowercaseSha256(record.externalRevision, "sop.externalRevision"),
      publishedAt: parseTimestamp(record.publishedAt, "sop.publishedAt")
    };
  });
}

export function parseSharedSopDetail(value: unknown): SharedSopDetail {
  const record = asRecord(value);
  assertActiveAsset(record, "sop");
  const content = asRecord(record.content);
  const sensitivity = content.sensitivity;
  if (sensitivity !== "project" && sensitivity !== "team" && sensitivity !== "company") {
    throw invalidResponse("sop.sensitivity");
  }
  if (!Array.isArray(content.evidence) || content.evidence.length > 64) {
    throw invalidResponse("sop.evidence");
  }
  const method = optionalExperienceMethod(content.method);
  if (method === undefined) throw invalidResponse("sop.method");
  const expiresAt = activeSopExpiry(content.expiresAt);
  return {
    id: boundedString(record.id, "sop.id"),
    projectId: boundedString(record.projectId, "sop.projectId"),
    stableKey: kebabIdentifier(content.stableKey, "sop.stableKey"),
    semanticVersion: boundedInteger(content.semanticVersion, "sop.semanticVersion", 1),
    ownerUserIdHash: lowercaseSha256(content.ownerUserIdHash, "sop.ownerUserIdHash"),
    title: boundedString(record.title, "sop.title", 512),
    taskType: boundedString(content.taskType, "sop.taskType", 256),
    problem: boundedString(content.problem, "sop.problem", 8_192),
    strategy: boundedString(content.strategy, "sop.strategy", 16_384),
    method,
    confidence: boundedNumber(content.confidence, "sop.confidence", 0, 1),
    sensitivity,
    applicableWhen: boundedStringArray(content.applicableWhen, "sop.applicableWhen"),
    notApplicableWhen: boundedStringArray(content.notApplicableWhen, "sop.notApplicableWhen"),
    evidence: content.evidence.map((item) => parseEvidence(item, "sop.evidence")),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    externalRevision: lowercaseSha256(record.externalRevision, "sop.externalRevision"),
    publishedAt: parseTimestamp(record.publishedAt, "sop.publishedAt")
  };
}

/** These parsers admit usable knowledge, not the server's governance history. */
function assertActiveAsset(record: Record<string, unknown>, kind: "experience" | "sop"): void {
  if (record.kind !== kind || record.status !== "active" || record.revokedAt !== null) {
    throw invalidResponse("shared.activeAsset");
  }
}

function activeSopExpiry(value: unknown): number | undefined {
  const expiresAt = optionalTimestamp(value, "sop.expiresAt");
  assertSopUnexpired(expiresAt === undefined ? {} : { expiresAt });
  return expiresAt;
}

/** Recheck after asynchronous feedback/observation before admitting the result. */
export function assertSopUnexpired(item: { expiresAt?: number }): void {
  if (item.expiresAt !== undefined && item.expiresAt <= Date.now()) throw invalidResponse("sop.expired");
}
