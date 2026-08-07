import { createHash } from "node:crypto";
import type { RuntimeIdentity } from "@pi67/domain";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  ReplaySafeControlMutationType
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export type ControlMutationCommand = AgentCommand<ReplaySafeControlMutationType>;
type ControlMutationResult = CommandResults[AgentCommandType];

interface MutationRecord {
  hostEpoch: number;
  type: ReplaySafeControlMutationType;
  fingerprint: string;
  promise: Promise<ControlMutationResult>;
  state: "pending" | "settled";
  settledAuthority?: RuntimeIdentity;
  settledRevision?: number;
  settledAt?: number;
}

export interface ControlMutationLedgerOptions {
  maxEntries?: number;
  maxPending?: number;
  retentionMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 16;
const DEFAULT_MAX_PENDING = 8;
const DEFAULT_RETENTION_MS = 5 * 60_000;

export class ControlMutationLedger {
  private readonly records = new Map<string, MutationRecord>();
  private readonly maxEntries: number;
  private readonly maxPending: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private mutationRevision = 0;

  constructor(
    private readonly hostEpoch: number,
    private readonly getIdentity: () => RuntimeIdentity,
    options: ControlMutationLedgerOptions = {}
  ) {
    this.maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, "maxEntries");
    this.maxPending = positiveInteger(options.maxPending, DEFAULT_MAX_PENDING, "maxPending");
    if (this.maxPending > this.maxEntries) {
      throw new RangeError("maxPending must not exceed maxEntries.");
    }
    this.retentionMs = positiveInteger(options.retentionMs, DEFAULT_RETENTION_MS, "retentionMs");
    this.now = options.now ?? Date.now;
  }

  run(
    idempotencyKey: string,
    command: ControlMutationCommand,
    execute: () => Promise<ControlMutationResult>
  ): Promise<ControlMutationResult> {
    this.prune();
    const fingerprint = fingerprintControlMutation(command);
    const existing = this.records.get(idempotencyKey);
    if (existing) {
      this.assertReplayMatches(existing, command.type, fingerprint);
      this.assertReplayIsCurrent(existing);
      return existing.promise;
    }

    this.reserveEntry();
    let record!: MutationRecord;
    const promise = Promise.resolve()
      .then(execute)
      .then(
        (result) => {
          this.settle(record);
          return result;
        },
        (error: unknown) => {
          this.settle(record);
          throw error;
        }
      );
    record = {
      hostEpoch: this.hostEpoch,
      type: command.type,
      fingerprint,
      promise,
      state: "pending"
    };
    this.records.set(idempotencyKey, record);
    return promise;
  }

  private assertReplayMatches(
    record: MutationRecord,
    type: ReplaySafeControlMutationType,
    fingerprint: string
  ): void {
    if (record.hostEpoch === this.hostEpoch && record.type === type && record.fingerprint === fingerprint) return;
    throw new HostCommandError(
      "DUPLICATE_REQUEST",
      "The idempotency key has already been used for a different control mutation.",
      false,
      { expectedType: record.type, receivedType: type }
    );
  }

  private assertReplayIsCurrent(record: MutationRecord): void {
    if (record.state === "pending") return;
    const current = this.getIdentity();
    if (!record.settledAuthority || !sameSessionIdentity(current, record.settledAuthority)) {
      throw new HostCommandError(
        "STALE_SESSION_IDENTITY",
        "The control mutation result belongs to a different physical Pi Session.",
        true,
        {
          sessionIdMatches:
            current.sessionId === record.settledAuthority?.sessionId,
          sessionFileIdentityMatches:
            current.sessionFileIdentity === record.settledAuthority?.sessionFileIdentity
        }
      );
    }
    if (current.sessionGeneration !== record.settledAuthority.sessionGeneration) {
      throw new HostCommandError(
        "STALE_SESSION_GENERATION",
        "The control mutation result belongs to a stale session generation.",
        true,
        {
          expectedSessionGeneration: record.settledAuthority?.sessionGeneration ?? -1,
          receivedSessionGeneration: current.sessionGeneration
        }
      );
    }
    if (record.settledRevision !== this.mutationRevision) {
      throw new HostCommandError(
        "DUPLICATE_REQUEST",
        "The control mutation result has been superseded by a newer runtime mutation.",
        false,
        { superseded: true }
      );
    }
  }

  private settle(record: MutationRecord): void {
    record.state = "settled";
    record.settledAuthority = this.getIdentity();
    record.settledRevision = ++this.mutationRevision;
    record.settledAt = this.now();
  }

  private reserveEntry(): void {
    const pendingCount = Array.from(this.records.values()).filter((record) => record.state === "pending").length;
    if (pendingCount >= this.maxPending) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many replay-safe control mutations are pending.",
        true,
        { maxPending: this.maxPending }
      );
    }
    while (this.records.size >= this.maxEntries) {
      const oldestSettled = Array.from(this.records.entries())
        .find(([, record]) => record.state === "settled");
      if (!oldestSettled) {
        throw new HostCommandError(
          "RESOURCE_LIMIT_EXCEEDED",
          "The replay-safe control mutation ledger is full.",
          true,
          { maxEntries: this.maxEntries }
        );
      }
      this.records.delete(oldestSettled[0]);
    }
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [key, record] of this.records) {
      if (record.state === "settled" && (record.settledAt ?? 0) <= cutoff) this.records.delete(key);
    }
  }
}

function fingerprintControlMutation(command: ControlMutationCommand): string {
  const hash = createHash("sha256");
  hash.update(command.type, "utf8").update("\0");
  writeCanonicalValue(hash, command.payload);
  return hash.digest("hex");
}

interface HashWriter {
  update(data: string, inputEncoding?: BufferEncoding): HashWriter;
}

function writeCanonicalValue(hash: HashWriter, value: unknown): void {
  if (value === null) {
    hash.update("null");
    return;
  }
  if (typeof value === "string") {
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value === "boolean") {
    hash.update(value ? "true" : "false");
    return;
  }
  if (Array.isArray(value)) {
    hash.update("[");
    value.forEach((item, index) => {
      if (index > 0) hash.update(",");
      writeCanonicalValue(hash, item);
    });
    hash.update("]");
    return;
  }
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    hash.update("{");
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    entries.forEach(([key, item], index) => {
      if (index > 0) hash.update(",");
      hash.update(JSON.stringify(key)).update(":");
      writeCanonicalValue(hash, item);
    });
    hash.update("}");
    return;
  }
  throw new HostCommandError(
    "INVALID_PAYLOAD",
    "The control mutation payload cannot be fingerprinted.",
    false
  );
}

function sameSessionIdentity(left: RuntimeIdentity, right: RuntimeIdentity): boolean {
  return (
    left.sessionId === right.sessionId
    && left.sessionFileIdentity === right.sessionFileIdentity
  );
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer.`);
  return resolved;
}
