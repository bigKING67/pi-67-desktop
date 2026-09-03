import { createHash } from "node:crypto";
import type {
  ExperienceCandidateSummary,
  ExperienceEvidenceSummary,
  ExperienceMethodSummary
} from "@pi67/domain";
import type { ExperienceCandidateReview } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { redactAndRequireExperience } from "./experience-candidate-redaction.js";
import type { StoredExperienceCandidate } from "./experience-candidate-store.js";

const HASH_REFERENCE = /^sha256:([a-f0-9]{64})$/u;

export function emptyExperienceMethod(): ExperienceMethodSummary {
  return {
    preconditions: [],
    steps: [],
    tools: [],
    validationGates: [],
    completionCriteria: [],
    failureModes: [],
    rollback: ""
  };
}

export function normalizeReviewMethod(method: ExperienceMethodSummary): ExperienceMethodSummary {
  return {
    preconditions: redactList(method.preconditions, 2_048, "precondition"),
    steps: redactList(method.steps, 2_048, "step"),
    tools: redactList(method.tools, 512, "tool"),
    validationGates: redactList(method.validationGates, 2_048, "validation gate"),
    completionCriteria: redactList(method.completionCriteria, 2_048, "completion criterion"),
    failureModes: redactList(method.failureModes, 2_048, "failure mode"),
    rollback: redactAndRequireExperience(method.rollback, 8_192, "rollback")
  };
}

export function normalizeReviewEvidence(
  candidate: StoredExperienceCandidate,
  review: ExperienceCandidateReview,
  now: number
): ExperienceEvidenceSummary[] {
  const evidence = [...candidate.summary.evidence];
  for (const item of review.evidence) {
    if (!HASH_REFERENCE.test(item.reference)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Experience evidence references must use sha256:<64 lowercase hex>.",
        false
      );
    }
    evidence.push({
      ...item,
      label: redactAndRequireExperience(item.label, 512, "evidence label")
    });
  }
  evidence.push({
    kind: "user-confirmation",
    label: "User confirmed task outcome and reviewed redaction",
    reference: `sha256:${sha256(JSON.stringify({
      candidateId: candidate.summary.id,
      result: review.result,
      sensitivity: review.sensitivity,
      method: review.method,
      confirmedAt: now
    }))}`,
    verifiedAt: now
  });
  return [...new Map(evidence.map((item) => [`${item.kind}:${item.reference}`, item])).values()].slice(-64);
}

export function updateSourceCases(
  cases: ExperienceCandidateSummary["sourceCases"],
  result: ExperienceCandidateSummary["result"],
  evidenceCount: number
): ExperienceCandidateSummary["sourceCases"] {
  return cases.map((item) => ({ ...item, result, evidenceCount }));
}

function redactList(values: string[], maximum: number, label: string): string[] {
  return values.map((item) => redactAndRequireExperience(item, maximum, label));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
