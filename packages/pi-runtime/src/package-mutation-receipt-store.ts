import { dirname, join, resolve } from "node:path";
import type { ExtensionPackageScope, PackageSourceKind } from "@pi67/domain";
import { withConfigurationFileLock } from "./atomic-private-file.js";
import {
  assertPackageObservation,
  ensurePackageReceiptDirectory,
  isPackageMutationReceiptRecord,
  packageReceiptIntegrityError,
  packageReceiptRecordKey,
  packageReceiptSha256,
  readPackageReceiptLedger,
  readPackageReceiptLedgerSync,
  sourceDigest,
  upsertPackageReceiptRecord,
  writePackageReceiptLedger,
  type ExtensionPackageObservation,
  type PackageMutationReceiptLedger,
  type PackageMutationReceiptRecord,
  type PackageReceiptOperation
} from "./package-mutation-receipt-ledger.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

export {
  sourceDigest,
  type DurablePackageReceiptState,
  type ExtensionPackageObservation,
  type PackageMutationReceiptRecord,
  type PackageReceiptOperation
} from "./package-mutation-receipt-ledger.js";

const PACKAGE_RECEIPT_DIRECTORY = "package-mutation-receipts-v1";
const packageReceiptProcessLocks = new Map<string, Promise<void>>();

export type PackageReceiptReadResult =
  | { status: "found"; record: PackageMutationReceiptRecord }
  | { status: "missing" }
  | { status: "invalid" };

export type PackageMutationReservation =
  | { status: "reserved"; record: PackageMutationReceiptRecord }
  | { status: "replay"; record: PackageMutationReceiptRecord };

export class PackageMutationReplayConflictError extends Error {
  constructor() {
    super("The Extension package mutation idempotency key is bound to another durable mutation.");
    this.name = "PackageMutationReplayConflictError";
  }
}

export interface PackageMutationReceiptStoreOptions {
  cwd: string;
  agentDir: string;
  storageRoot?: string;
  now?: () => number;
}

/** Durable, redacted receipts for Desktop-owned third-party package mutations. */
export class PackageMutationReceiptStore {
  readonly #cwd: string;
  readonly #agentDir: string;
  readonly #storageRoot: string | undefined;
  readonly #now: () => number;

  constructor(options: PackageMutationReceiptStoreOptions) {
    this.#cwd = resolve(options.cwd);
    this.#agentDir = resolve(options.agentDir);
    this.#storageRoot = options.storageRoot === undefined ? undefined : resolve(options.storageRoot);
    this.#now = options.now ?? Date.now;
  }

  read(source: string, scope: ExtensionPackageScope): PackageReceiptReadResult {
    const owner = this.#owner(scope);
    if (!owner.path) return { status: "invalid" };
    try {
      const ledger = readPackageReceiptLedgerSync(owner.path, owner.ownerKey);
      if (!ledger) return { status: "missing" };
      const record = ledger.records.find((candidate) => candidate.recordKey === packageReceiptRecordKey(
        owner.ownerKey,
        scope,
        sourceDigest(source)
      ));
      return record ? { status: "found", record: structuredClone(record) } : { status: "missing" };
    } catch {
      return { status: "invalid" };
    }
  }

  reserve(input: {
    source: string;
    scope: ExtensionPackageScope;
    sourceKind: Exclude<PackageSourceKind, "bundled">;
    operation: PackageReceiptOperation;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<PackageMutationReservation> {
    const owner = this.#requireOwner(input.scope);
    const digest = sourceDigest(input.source);
    const key = packageReceiptRecordKey(owner.ownerKey, input.scope, digest);
    const mutationKeyDigest = packageReceiptSha256(input.idempotencyKey);
    const fingerprintDigest = packageReceiptSha256(input.fingerprint);
    return this.#withLedger(owner, true, (ledger) => {
      const keyed = ledger.records.find((record) => record.mutationKeyDigest === mutationKeyDigest);
      if (keyed) {
        if (keyed.recordKey !== key || keyed.fingerprintDigest !== fingerprintDigest) {
          throw new PackageMutationReplayConflictError();
        }
        return { status: "replay", record: structuredClone(keyed) };
      }
      const now = this.#timestamp();
      const record: PackageMutationReceiptRecord = {
        recordKey: key,
        sourceDigest: digest,
        scope: input.scope,
        sourceKind: input.sourceKind,
        state: "reserved",
        lastOperation: input.operation,
        mutationKeyDigest,
        fingerprintDigest,
        startedAt: now
      };
      upsertPackageReceiptRecord(ledger, record);
      return { status: "reserved", record: structuredClone(record) };
    });
  }

  markMutating(source: string, scope: ExtensionPackageScope, mutationKey: string): Promise<void> {
    return this.#transition(source, scope, mutationKey, (record) => ({
      ...record,
      state: "mutating"
    }));
  }

  commitActive(
    source: string,
    scope: ExtensionPackageScope,
    mutationKey: string,
    observation: ExtensionPackageObservation,
    changed: boolean
  ): Promise<void> {
    assertPackageObservation(observation);
    return this.#transition(source, scope, mutationKey, (record) => ({
      ...record,
      state: "active",
      completedAt: this.#timestamp(),
      changed,
      observation: structuredClone(observation)
    }));
  }

  commitRemoved(
    source: string,
    scope: ExtensionPackageScope,
    mutationKey: string,
    changed: boolean
  ): Promise<void> {
    return this.#transition(source, scope, mutationKey, (record) => {
      const { observation: _observation, ...withoutObservation } = record;
      return {
        ...withoutObservation,
        state: "removed",
        completedAt: this.#timestamp(),
        changed
      };
    });
  }

  markAmbiguous(source: string, scope: ExtensionPackageScope, mutationKey: string): Promise<void> {
    return this.#transition(source, scope, mutationKey, (record) => {
      const { observation: _observation, ...withoutObservation } = record;
      return {
        ...withoutObservation,
        state: "ambiguous",
        completedAt: this.#timestamp()
      };
    });
  }

  refreshActiveObservation(
    source: string,
    scope: ExtensionPackageScope,
    observation: ExtensionPackageObservation
  ): Promise<boolean> {
    assertPackageObservation(observation);
    const owner = this.#requireOwner(scope);
    const key = packageReceiptRecordKey(owner.ownerKey, scope, sourceDigest(source));
    return this.#withLedger(owner, true, (ledger) => {
      const index = ledger.records.findIndex((record) => record.recordKey === key);
      const existing = ledger.records[index];
      if (!existing || existing.state !== "active") return false;
      ledger.records[index] = {
        ...existing,
        completedAt: this.#timestamp(),
        observation: structuredClone(observation)
      };
      return true;
    });
  }

  #transition(
    source: string,
    scope: ExtensionPackageScope,
    mutationKey: string,
    transition: (record: PackageMutationReceiptRecord) => PackageMutationReceiptRecord
  ): Promise<void> {
    const owner = this.#requireOwner(scope);
    const key = packageReceiptRecordKey(owner.ownerKey, scope, sourceDigest(source));
    const mutationKeyDigest = packageReceiptSha256(mutationKey);
    return this.#withLedger(owner, true, (ledger) => {
      const index = ledger.records.findIndex((record) => record.recordKey === key);
      const existing = ledger.records[index];
      if (!existing || existing.mutationKeyDigest !== mutationKeyDigest) throw packageReceiptIntegrityError();
      const next = transition(structuredClone(existing));
      if (!isPackageMutationReceiptRecord(next, owner.ownerKey)) throw packageReceiptIntegrityError();
      ledger.records[index] = next;
    });
  }

  async #withLedger<T>(
    owner: ReceiptOwner,
    write: boolean,
    operation: (ledger: PackageMutationReceiptLedger) => T
  ): Promise<T> {
    await ensurePackageReceiptDirectory(dirname(owner.path!));
    return withPackageReceiptProcessLock(owner.path!, () => (
      withConfigurationFileLock(owner.path!, async () => {
        const ledger = await readPackageReceiptLedger(owner.path!, owner.ownerKey)
          ?? { version: 1, ownerKey: owner.ownerKey, records: [] };
        const result = operation(ledger);
        if (write) await writePackageReceiptLedger(owner.path!, ledger);
        return result;
      })
    ));
  }

  #owner(scope: ExtensionPackageScope): ReceiptOwner {
    const ownerKey = scope === "global"
      ? packageReceiptSha256(`global\0${normalizeSessionCatalogPathIdentity(this.#agentDir)}`)
      : packageReceiptSha256(
          `project\0${normalizeSessionCatalogPathIdentity(this.#cwd)}\0${normalizeSessionCatalogPathIdentity(this.#agentDir)}`
        );
    return {
      ownerKey,
      path: this.#storageRoot === undefined
        ? undefined
        : join(this.#storageRoot, PACKAGE_RECEIPT_DIRECTORY, `${ownerKey}.json`)
    };
  }

  #requireOwner(scope: ExtensionPackageScope): ReceiptOwner & { path: string } {
    const owner = this.#owner(scope);
    if (!owner.path) throw packageReceiptIntegrityError();
    return { ...owner, path: owner.path };
  }

  #timestamp(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw packageReceiptIntegrityError();
    return value;
  }
}

async function withPackageReceiptProcessLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const predecessor = packageReceiptProcessLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  const queued = predecessor.then(() => current);
  packageReceiptProcessLocks.set(path, queued);
  await predecessor;
  try {
    return await operation();
  } finally {
    release();
    if (packageReceiptProcessLocks.get(path) === queued) packageReceiptProcessLocks.delete(path);
  }
}

interface ReceiptOwner {
  ownerKey: string;
  path: string | undefined;
}
