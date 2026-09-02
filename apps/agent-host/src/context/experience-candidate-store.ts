import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExperienceCandidateSummary } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";
import type { SessionCommitProvenance } from "./experience-candidate-provenance.js";

const STORE_SCHEMA = "pi67-experience-candidates.v1";
const MAX_STORE_BYTES = 4 * 1_024 * 1_024;
const MAX_COMMIT_RECEIPTS = 512;
const MAX_CANDIDATES = 512;

export type CandidateCommitState =
  | "prepared"
  | "tracking"
  | "completed"
  | "skipped"
  | "failed"
  | "ambiguous";

export interface CandidateCommitReceipt extends SessionCommitProvenance {
  submissionId: string;
  state: CandidateCommitState;
  taskId?: string;
  createdAt: number;
  updatedAt: number;
  candidateIds: string[];
  detail?: string;
}

interface StoredCandidateSource {
  commitSubmissionId: string;
  workspaceFingerprint: string;
  sourceSessionIdHash: string;
  sessionContentHash: string;
  experienceUri: string;
  experienceUriHash: string;
  experienceContentHash: string;
}

export interface StoredExperienceCandidate {
  summary: ExperienceCandidateSummary;
  source: StoredCandidateSource;
}

interface CandidateStoreState {
  schema: typeof STORE_SCHEMA;
  receipts: CandidateCommitReceipt[];
  candidates: StoredExperienceCandidate[];
}

const EMPTY_STATE: CandidateStoreState = {
  schema: STORE_SCHEMA,
  receipts: [],
  candidates: []
};

export class ExperienceCandidateStore {
  readonly path: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(agentDir: string) {
    this.path = join(agentDir, "context-memory", "experience-candidates.v1.json");
  }

  prepareCommit(
    submissionId: string,
    provenance: SessionCommitProvenance
  ): Promise<{ receipt: CandidateCommitReceipt; created: boolean }> {
    return this.mutate<{ receipt: CandidateCommitReceipt; created: boolean }>((state) => {
      const existing = state.receipts.find((item) => item.submissionId === submissionId);
      if (existing) {
        if (!sameProvenance(existing, provenance)) {
          throw new HostCommandError(
            "DUPLICATE_REQUEST",
            "The candidate Commit submission was reused for different Pi JSONL provenance.",
            false
          );
        }
        return { value: { receipt: existing, created: false }, changed: false };
      }
      const now = Date.now();
      const receipt: CandidateCommitReceipt = {
        ...provenance,
        submissionId,
        state: "prepared",
        createdAt: now,
        updatedAt: now,
        candidateIds: []
      };
      state.receipts.unshift(receipt);
      state.receipts = state.receipts.slice(0, MAX_COMMIT_RECEIPTS);
      return { value: { receipt, created: true }, changed: true };
    });
  }

  markCommitTracking(submissionId: string, taskId: string): Promise<CandidateCommitReceipt> {
    return this.updateReceipt(submissionId, (receipt) => {
      const { detail: _detail, ...rest } = receipt;
      return {
        ...rest,
        state: "tracking",
        taskId,
        updatedAt: Date.now()
      };
    });
  }

  markCommitTerminal(
    submissionId: string,
    state: Exclude<CandidateCommitState, "prepared" | "tracking">,
    detail?: string,
    candidateIds?: string[]
  ): Promise<CandidateCommitReceipt> {
    return this.updateReceipt(submissionId, (receipt) => {
      const { detail: _detail, ...rest } = receipt;
      return {
        ...rest,
        state,
        updatedAt: Date.now(),
        ...(candidateIds === undefined ? {} : { candidateIds: [...new Set(candidateIds)].slice(0, 128) }),
        ...(detail === undefined ? {} : { detail: boundedText(detail, 2_048) })
      };
    });
  }

  async trackingReceipts(workspaceId: string): Promise<CandidateCommitReceipt[]> {
    const state = await this.read();
    return state.receipts
      .filter((item) => item.workspaceId === workspaceId && item.state === "tracking" && item.taskId)
      .map(cloneReceipt);
  }

  upsertCandidates(candidates: StoredExperienceCandidate[]): Promise<StoredExperienceCandidate[]> {
    return this.mutate((state) => {
      const saved: StoredExperienceCandidate[] = [];
      for (const candidate of candidates) {
        const normalized = cloneCandidate(candidate);
        const index = state.candidates.findIndex((item) => item.summary.id === normalized.summary.id);
        if (index >= 0) state.candidates[index] = normalized;
        else state.candidates.unshift(normalized);
        saved.push(normalized);
      }
      state.candidates = state.candidates.slice(0, MAX_CANDIDATES);
      return { value: saved, changed: candidates.length > 0 };
    });
  }

  async listCandidates(workspaceId: string): Promise<StoredExperienceCandidate[]> {
    const state = await this.read();
    return state.candidates
      .filter((item) => item.summary.workspaceId === workspaceId)
      .map(cloneCandidate)
      .sort((left, right) => right.summary.updatedAt - left.summary.updatedAt);
  }

  async getCandidate(id: string, workspaceId: string): Promise<StoredExperienceCandidate | undefined> {
    const state = await this.read();
    const item = state.candidates.find((candidate) => (
      candidate.summary.id === id && candidate.summary.workspaceId === workspaceId
    ));
    return item ? cloneCandidate(item) : undefined;
  }

  updateCandidate(
    id: string,
    workspaceId: string,
    expectedUpdatedAt: number | undefined,
    update: (candidate: StoredExperienceCandidate) => StoredExperienceCandidate
  ): Promise<StoredExperienceCandidate> {
    return this.mutate((state) => {
      const index = state.candidates.findIndex((candidate) => (
        candidate.summary.id === id && candidate.summary.workspaceId === workspaceId
      ));
      if (index < 0) {
        throw new HostCommandError("RESOURCE_NOT_FOUND", "The Experience candidate is not available locally.", true);
      }
      const current = state.candidates[index]!;
      if (expectedUpdatedAt !== undefined && current.summary.updatedAt !== expectedUpdatedAt) {
        throw new HostCommandError(
          "RESOURCE_CHANGED_EXTERNALLY",
          "The Experience candidate changed. Reload it before reviewing.",
          true
        );
      }
      const next = cloneCandidate(update(cloneCandidate(current)));
      state.candidates[index] = next;
      return { value: next, changed: true };
    });
  }

  private updateReceipt(
    submissionId: string,
    update: (receipt: CandidateCommitReceipt) => CandidateCommitReceipt
  ): Promise<CandidateCommitReceipt> {
    return this.mutate((state) => {
      const index = state.receipts.findIndex((item) => item.submissionId === submissionId);
      if (index < 0) {
        throw new HostCommandError("RESOURCE_NOT_FOUND", "The candidate Commit receipt is unavailable.", true);
      }
      const next = cloneReceipt(update(cloneReceipt(state.receipts[index]!)));
      state.receipts[index] = next;
      return { value: next, changed: true };
    });
  }

  private mutate<T>(
    operation: (state: CandidateStoreState) => { value: T; changed: boolean }
  ): Promise<T> {
    const result = this.queue.then(async () => {
      const state = await this.readDirect();
      const mutation = operation(state);
      if (mutation.changed) await this.write(state);
      return mutation.value;
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<CandidateStoreState> {
    await this.queue;
    return this.readDirect();
  }

  private async readDirect(): Promise<CandidateStoreState> {
    const metadata = await stat(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!metadata) return cloneState(EMPTY_STATE);
    const link = await lstat(this.path);
    if (!link.isFile() || link.isSymbolicLink() || metadata.size > MAX_STORE_BYTES) {
      throw invalidStore();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      throw invalidStore();
    }
    return parseState(parsed);
  }

  private async write(state: CandidateStoreState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) {
      throw new HostCommandError("RESOURCE_LIMIT_EXCEEDED", "The local Experience candidate store is full.", true);
    }
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function parseState(value: unknown): CandidateStoreState {
  if (!isRecord(value) || value.schema !== STORE_SCHEMA) throw invalidStore();
  if (!Array.isArray(value.receipts) || value.receipts.length > MAX_COMMIT_RECEIPTS) throw invalidStore();
  if (!Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES) throw invalidStore();
  const receipts = value.receipts.map(parseReceipt);
  const candidates = value.candidates.map(parseCandidate);
  if (new Set(receipts.map((item) => item.submissionId)).size !== receipts.length) throw invalidStore();
  if (new Set(candidates.map((item) => item.summary.id)).size !== candidates.length) throw invalidStore();
  return { schema: STORE_SCHEMA, receipts, candidates };
}

function parseReceipt(value: unknown): CandidateCommitReceipt {
  if (!isRecord(value)) throw invalidStore();
  const state = value.state;
  if (!isCommitState(state)) throw invalidStore();
  const receipt: CandidateCommitReceipt = {
    submissionId: text(value.submissionId, 512),
    workspaceId: text(value.workspaceId, 512),
    workspaceFingerprint: hash(value.workspaceFingerprint),
    sourceSessionIdHash: hash(value.sourceSessionIdHash),
    sessionContentHash: hash(value.sessionContentHash),
    sessionFileIdentityHash: hash(value.sessionFileIdentityHash),
    sessionBytes: integer(value.sessionBytes),
    capturedAt: integer(value.capturedAt),
    state,
    createdAt: integer(value.createdAt),
    updatedAt: integer(value.updatedAt),
    candidateIds: stringArray(value.candidateIds, 128, 512)
  };
  if (value.taskId !== undefined) receipt.taskId = text(value.taskId, 512);
  if (value.detail !== undefined) receipt.detail = text(value.detail, 2_048);
  return receipt;
}

function parseCandidate(value: unknown): StoredExperienceCandidate {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.source)) throw invalidStore();
  return cloneCandidate(value as unknown as StoredExperienceCandidate);
}

function cloneState(state: CandidateStoreState): CandidateStoreState {
  return {
    schema: STORE_SCHEMA,
    receipts: state.receipts.map(cloneReceipt),
    candidates: state.candidates.map(cloneCandidate)
  };
}

function cloneReceipt(receipt: CandidateCommitReceipt): CandidateCommitReceipt {
  return {
    ...receipt,
    candidateIds: [...receipt.candidateIds]
  };
}

function cloneCandidate(candidate: StoredExperienceCandidate): StoredExperienceCandidate {
  const summary = candidate.summary;
  const source = candidate.source;
  if (!isCandidateSummary(summary) || !isCandidateSource(source)) throw invalidStore();
  return {
    summary: {
      ...summary,
      applicableWhen: [...summary.applicableWhen],
      notApplicableWhen: [...summary.notApplicableWhen],
      evidence: summary.evidence.map((item) => ({ ...item }))
    },
    source: { ...source }
  };
}

function isCandidateSummary(value: ExperienceCandidateSummary): boolean {
  return typeof value === "object"
    && value !== null
    && textOrFalse(value.id, 512)
    && textOrFalse(value.workspaceId, 512)
    && textOrFalse(value.taskType, 256)
    && textOrFalse(value.title, 512)
    && textOrFalse(value.problem, 8_192)
    && textOrFalse(value.strategy, 16_384)
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
      && textOrFalse(item.label, 512)
      && textOrFalse(item.reference, 2_048)
      && Number.isSafeInteger(item.verifiedAt)
    ));
}

function isCandidateSource(value: StoredCandidateSource): boolean {
  return typeof value === "object"
    && value !== null
    && textOrFalse(value.commitSubmissionId, 512)
    && hashOrFalse(value.workspaceFingerprint)
    && hashOrFalse(value.sourceSessionIdHash)
    && hashOrFalse(value.sessionContentHash)
    && textOrFalse(value.experienceUri, 4_096)
    && hashOrFalse(value.experienceUriHash)
    && hashOrFalse(value.experienceContentHash);
}

function sameProvenance(
  left: CandidateCommitReceipt,
  right: SessionCommitProvenance
): boolean {
  return left.workspaceId === right.workspaceId
    && left.workspaceFingerprint === right.workspaceFingerprint
    && left.sourceSessionIdHash === right.sourceSessionIdHash
    && left.sessionContentHash === right.sessionContentHash
    && left.sessionFileIdentityHash === right.sessionFileIdentityHash
    && left.sessionBytes === right.sessionBytes;
}

function isCommitState(value: unknown): value is CandidateCommitState {
  return value === "prepared"
    || value === "tracking"
    || value === "completed"
    || value === "skipped"
    || value === "failed"
    || value === "ambiguous";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw invalidStore();
  return value;
}

function boundedText(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidStore();
  return value as number;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !hashOrFalse(value)) throw invalidStore();
  return value;
}

function hashOrFalse(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function textOrFalse(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw invalidStore();
  return value.map((item) => text(item, maximumLength));
}

function invalidStore(): HostCommandError {
  return new HostCommandError(
    "INVALID_PAYLOAD",
    "The local Experience candidate store is invalid. Pi remains available and enterprise submission is disabled.",
    true
  );
}
