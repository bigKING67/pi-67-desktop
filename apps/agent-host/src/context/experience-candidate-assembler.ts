import { createHash } from "node:crypto";
import type { ExperienceCandidateSummary, ExperienceEvidenceSummary } from "@pi67/domain";
import type { ExperienceCandidateReview } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { assertPrivateMemoryUri, titleForUri } from "./context-memory-support.js";
import type {
  CandidateCommitReceipt,
  StoredExperienceCandidate
} from "./experience-candidate-store.js";
import { ExperienceCandidateStore } from "./experience-candidate-store.js";
import { redactAndRequireExperience } from "./experience-candidate-redaction.js";
import {
  emptyExperienceMethod,
  normalizeReviewEvidence,
  normalizeReviewMethod,
  updateSourceCases
} from "./experience-candidate-review.js";
import { validateEnterpriseExperienceMethod } from "./experience-enterprise-method.js";
import type { OpenVikingClient, OpenVikingCommitTaskResult } from "./openviking-client.js";

const MAX_RECONCILIATIONS_PER_READ = 8;
const MAX_MEMORY_DIFF_BYTES = 2 * 1_024 * 1_024;
const MAX_MEMORY_OPERATIONS = 256;

interface MemoryDiffOperation {
  uri: string;
  memoryType: string;
  after: string;
}

interface MemoryDiffReceipt {
  archiveUri: string;
  operations: MemoryDiffOperation[];
}

interface ParsedExperience {
  title: string;
  situation: string;
  approach: string;
  reflection: string;
}

export async function reconcileExperienceCandidates(input: {
  store: ExperienceCandidateStore;
  client: OpenVikingClient;
  workspaceId: string;
  onCreated: (candidate: ExperienceCandidateSummary) => void;
  onFailed: (receipt: CandidateCommitReceipt, detail: string) => void;
}): Promise<void> {
  const receipts = (await input.store.trackingReceipts(input.workspaceId))
    .slice(0, MAX_RECONCILIATIONS_PER_READ);
  for (const receipt of receipts) {
    try {
      await reconcileReceipt(input.store, input.client, receipt, input.onCreated);
    } catch (error) {
      input.onFailed(
        receipt,
        bounded(error instanceof Error ? error.message : "Experience candidate assembly failed.", 2_048)
      );
    }
  }
}

export async function listPrivateExperienceSummaries(
  client: OpenVikingClient,
  workspaceId: string,
  limit: number
): Promise<ExperienceCandidateSummary[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const memoryRoots = await client.listDirectory("viking://user/memories", 32).catch((error) => {
    if (isNotFound(error)) return [];
    throw error;
  });
  const experienceRoot = memoryRoots.find((uri) => uri.endsWith("/memories/experiences"));
  if (!experienceRoot) return [];
  const uris = await client.listDirectory(experienceRoot, boundedLimit).catch((error) => {
    if (isNotFound(error)) return [];
    throw error;
  });
  const summaries: ExperienceCandidateSummary[] = [];
  for (const uri of uris.slice(0, boundedLimit)) {
    if (!isPrivateExperienceUri(uri)) continue;
    const content = await client.read(uri);
    const parsed = parseExperience(content, titleForUri(uri));
    summaries.push({
      id: uri,
      taskType: "openviking-experience",
      title: parsed.title,
      problem: parsed.situation,
      strategy: joinStrategy(parsed),
      result: "partial",
      confidence: 0.5,
      status: "private",
      sensitivity: "private",
      sourceCases: [],
      method: emptyExperienceMethod(),
      applicableWhen: [bounded(parsed.situation, 2_048)],
      notApplicableWhen: [],
      evidence: [],
      redactionStatus: "pending",
      workspaceId,
      createdAt: 0,
      updatedAt: 0
    });
  }
  return summaries;
}

export async function getPrivateExperienceSummary(
  client: OpenVikingClient,
  workspaceId: string,
  uri: string
): Promise<ExperienceCandidateSummary> {
  if (!isPrivateExperienceUri(uri)) {
    throw new HostCommandError("INVALID_PAYLOAD", "Only private OpenViking Experiences can be read here.", false);
  }
  assertPrivateMemoryUri(uri);
  const content = await client.read(uri);
  const parsed = parseExperience(content, titleForUri(uri));
  return {
    id: uri,
    taskType: "openviking-experience",
    title: parsed.title,
    problem: parsed.situation,
    strategy: joinStrategy(parsed),
    result: "partial",
    confidence: 0.5,
    status: "private",
    sensitivity: "private",
    sourceCases: [],
    method: emptyExperienceMethod(),
    applicableWhen: [bounded(parsed.situation, 2_048)],
    notApplicableWhen: [],
    evidence: [],
    redactionStatus: "pending",
    workspaceId,
    createdAt: 0,
    updatedAt: 0
  };
}

export function reviewExperienceCandidate(
  candidate: StoredExperienceCandidate,
  review: ExperienceCandidateReview,
  now = Date.now()
): StoredExperienceCandidate {
  if (candidate.summary.status === "submitted" || candidate.summary.status === "shared") {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "A submitted or shared Experience candidate cannot be rewritten locally.",
      false
    );
  }
  const evidence = normalizeReviewEvidence(candidate, review, now);
  const method = normalizeReviewMethod(review.method);
  const {
    enterpriseCandidateId: _enterpriseCandidateId,
    submittedAt: _submittedAt,
    ...currentSummary
  } = candidate.summary;
  const summary: ExperienceCandidateSummary = {
    ...currentSummary,
    taskType: redactAndRequireExperience(review.taskType, 256, "task type"),
    title: redactAndRequireExperience(review.title, 512, "title"),
    problem: redactAndRequireExperience(review.problem, 8_192, "problem"),
    strategy: redactAndRequireExperience(review.strategy, 16_384, "strategy"),
    result: review.result,
    confidence: review.confidence,
    status: "validated",
    sensitivity: review.sensitivity,
    sourceCases: updateSourceCases(candidate.summary.sourceCases, review.result, evidence.length),
    method,
    applicableWhen: review.applicableWhen.map((item) => redactAndRequireExperience(item, 2_048, "applicable condition")),
    notApplicableWhen: review.notApplicableWhen.map((item) => redactAndRequireExperience(item, 2_048, "excluded condition")),
    evidence,
    redactionStatus: "passed",
    updatedAt: Math.max(now, candidate.summary.updatedAt + 1)
  };
  validateEnterpriseExperienceMethod(summary.method);
  return { summary, source: { ...candidate.source } };
}

export function rejectExperienceCandidate(
  candidate: StoredExperienceCandidate,
  reason: string,
  now = Date.now()
): StoredExperienceCandidate {
  const label = redactAndRequireExperience(reason, 512, "rejection reason");
  return {
    ...candidate,
    summary: {
      ...candidate.summary,
      status: "rejected",
      updatedAt: Math.max(now, candidate.summary.updatedAt + 1),
      evidence: [...candidate.summary.evidence, {
        kind: "user-confirmation" as const,
        label: `Local rejection: ${label}`,
        reference: `sha256:${sha256(`${candidate.summary.id}:${label}`)}`,
        verifiedAt: now
      }].slice(-64)
    }
  };
}

async function reconcileReceipt(
  store: ExperienceCandidateStore,
  client: OpenVikingClient,
  receipt: CandidateCommitReceipt,
  onCreated: (candidate: ExperienceCandidateSummary) => void
): Promise<void> {
  const task = await client.getTask(receipt.taskId!);
  if (task.status === "pending" || task.status === "running" || task.status === "cancelling") return;
  if (task.status === "failed" || task.status === "cancelled") {
    await store.markCommitTerminal(receipt.submissionId, "failed", `OpenViking task ${task.status}.`);
    return;
  }
  if (task.task_type !== "session_commit" || !task.result) {
    await store.markCommitTerminal(receipt.submissionId, "failed", "OpenViking completed without a Session Commit result.");
    return;
  }
  assertTaskProvenance(receipt, task.result);
  const diff = parseMemoryDiff(await client.read(task.result.memory_diff_uri));
  if (diff.archiveUri !== task.result.archive_uri) {
    throw new HostCommandError("INVALID_PAYLOAD", "OpenViking memory-diff archive provenance did not match the Commit task.", false);
  }
  const candidates = diff.operations
    .filter((operation) => operation.memoryType === "experiences" && isPrivateExperienceUri(operation.uri))
    .map((operation) => buildCandidate(receipt, operation));
  const existingIds = new Set((await store.listCandidates(receipt.workspaceId)).map((item) => item.summary.id));
  const saved = await store.upsertCandidates(candidates);
  await store.markCommitTerminal(receipt.submissionId, "completed", undefined, saved.map((item) => item.summary.id));
  for (const item of saved) {
    if (!existingIds.has(item.summary.id)) onCreated(item.summary);
  }
}

function assertTaskProvenance(receipt: CandidateCommitReceipt, task: OpenVikingCommitTaskResult): void {
  if (sha256(task.session_id) !== receipt.sourceSessionIdHash) {
    throw new HostCommandError("INVALID_PAYLOAD", "OpenViking Commit task Session identity did not match Pi JSONL provenance.", false);
  }
}

function buildCandidate(
  receipt: CandidateCommitReceipt,
  operation: MemoryDiffOperation
): StoredExperienceCandidate {
  const experienceContentHash = sha256(operation.after);
  const experienceUriHash = sha256(operation.uri);
  const id = `local-candidate-${sha256(`${receipt.submissionId}:${experienceUriHash}:${experienceContentHash}`).slice(0, 32)}`;
  const parsed = parseExperience(operation.after, titleForUri(operation.uri));
  const now = Date.now();
  return {
    summary: {
      id,
      taskType: "openviking-experience",
      title: redactAndRequireExperience(parsed.title, 512, "title"),
      problem: redactAndRequireExperience(parsed.situation, 8_192, "problem"),
      strategy: redactAndRequireExperience(joinStrategy(parsed), 16_384, "strategy"),
      result: "partial",
      confidence: 0.5,
      status: "candidate",
      sensitivity: "project",
      sourceCases: [{
        id: `case-${sha256(`${receipt.sourceSessionIdHash}:${receipt.sessionContentHash}`).slice(0, 32)}`,
        source: "pi-session-commit",
        result: "partial",
        evidenceCount: 2,
        workspaceId: receipt.workspaceId,
        capturedAt: receipt.capturedAt
      }],
      method: emptyExperienceMethod(),
      applicableWhen: [redactAndRequireExperience(parsed.situation, 2_048, "applicable condition")],
      notApplicableWhen: [],
      evidence: [
        artifactEvidence("Pi JSONL snapshot", receipt.sessionContentHash, receipt.capturedAt),
        artifactEvidence("OpenViking Experience snapshot", experienceContentHash, now)
      ],
      redactionStatus: "pending",
      workspaceId: receipt.workspaceId,
      createdAt: now,
      updatedAt: now
    },
    source: {
      commitSubmissionId: receipt.submissionId,
      workspaceFingerprint: receipt.workspaceFingerprint,
      sourceSessionIdHash: receipt.sourceSessionIdHash,
      sessionContentHash: receipt.sessionContentHash,
      experienceUri: operation.uri,
      experienceUriHash,
      experienceContentHash
    }
  };
}

function parseMemoryDiff(content: string): MemoryDiffReceipt {
  if (Buffer.byteLength(content) > MAX_MEMORY_DIFF_BYTES) {
    throw new HostCommandError("RESOURCE_LIMIT_EXCEEDED", "OpenViking memory_diff.json is too large.", true);
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new HostCommandError("INVALID_PAYLOAD", "OpenViking memory_diff.json is not valid JSON.", false);
  }
  if (!isRecord(value) || !isRecord(value.operations)) throw invalidMemoryDiff();
  const adds = operationArray(value.operations.adds);
  const updates = operationArray(value.operations.updates);
  if (adds.length + updates.length > MAX_MEMORY_OPERATIONS) throw invalidMemoryDiff();
  return {
    archiveUri: requiredText(value.archive_uri, 4_096),
    operations: [...adds, ...updates]
  };
}

function operationArray(value: unknown): MemoryDiffOperation[] {
  if (!Array.isArray(value) || value.length > MAX_MEMORY_OPERATIONS) throw invalidMemoryDiff();
  return value.map((item) => {
    if (!isRecord(item)) throw invalidMemoryDiff();
    return {
      uri: requiredText(item.uri, 4_096),
      memoryType: requiredText(item.memory_type, 128),
      after: requiredText(item.after, 256_000)
    };
  });
}

function parseExperience(content: string, fallbackTitle: string): ParsedExperience {
  const boundedContent = bounded(content.trim(), 64_000);
  const json = parseJsonRecord(boundedContent);
  if (json) {
    const situation = firstText(json, ["situation", "problem", "context"]);
    const approach = firstText(json, ["approach", "strategy", "solution", "content"]);
    const reflection = firstText(json, ["reflect", "reflection", "lessons"]);
    if (situation || approach || reflection) {
      return {
        title: firstText(json, ["experience_name", "title", "name"]) || fallbackTitle,
        situation: situation || "OpenViking Experience context",
        approach: approach || reflection || boundedContent,
        reflection
      };
    }
  }
  const sections = markdownSections(boundedContent);
  const paragraphs = boundedContent.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean);
  return {
    title: sections.title || fallbackTitle,
    situation: sections.situation || paragraphs[0] || "OpenViking Experience context",
    approach: sections.approach || paragraphs.slice(1).join("\n\n") || paragraphs[0] || "Review the private Experience before submission.",
    reflection: sections.reflection
  };
}

function markdownSections(content: string): ParsedExperience {
  const result: ParsedExperience = { title: "", situation: "", approach: "", reflection: "" };
  let current: keyof ParsedExperience | undefined;
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim();
    if (heading && !result.title) result.title = heading;
    const keyValue = line.match(/^(experience_name|title|name|situation|problem|approach|strategy|reflect|reflection)\s*:\s*(.*)$/iu);
    const label = (keyValue?.[1] ?? heading ?? line.replace(/:$/u, "")).toLowerCase();
    const mapped = sectionFor(label);
    if (mapped) {
      current = mapped;
      const inline = keyValue?.[2]?.trim();
      if (inline) result[mapped] = append(result[mapped], inline);
      continue;
    }
    if (current) result[current] = append(result[current], line);
  }
  return result;
}

function sectionFor(label: string): keyof ParsedExperience | undefined {
  if (["experience_name", "title", "name", "经验名称"].includes(label)) return "title";
  if (["situation", "problem", "context", "场景", "问题", "背景"].includes(label)) return "situation";
  if (["approach", "strategy", "solution", "方法", "策略", "方案"].includes(label)) return "approach";
  if (["reflect", "reflection", "lessons", "复盘", "反思", "经验"].includes(label)) return "reflection";
  return undefined;
}

function artifactEvidence(label: string, hash: string, verifiedAt: number): ExperienceEvidenceSummary {
  return { kind: "artifact", label, reference: `sha256:${hash}`, verifiedAt };
}

function joinStrategy(value: ParsedExperience): string {
  return value.reflection
    ? `${value.approach}\n\nReflection:\n${value.reflection}`
    : value.approach;
}

function isPrivateExperienceUri(uri: string): boolean {
  return /^viking:\/\/user\/(?:[^/?#]+\/)?memories\/experiences\/.+/u.test(uri)
    || /^viking:\/\/user\/[^/?#]+\/peers\/[a-f0-9]{64}\/memories\/experiences\/.+/u.test(uri);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstText(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function append(current: string, value: string): string {
  return current ? `${current}\n${value}` : value;
}

function operationDetail(error: unknown): Record<string, unknown> | undefined {
  return error instanceof HostCommandError ? error.details : undefined;
}

function isNotFound(error: unknown): boolean {
  return error instanceof HostCommandError
    && (operationDetail(error)?.status === 404 || /not found/iu.test(error.message));
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw invalidMemoryDiff();
  return value;
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidMemoryDiff(): HostCommandError {
  return new HostCommandError("INVALID_PAYLOAD", "OpenViking returned an invalid memory_diff.json receipt.", false);
}
