import { realpath, type BigIntStats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { createMessageId } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  type DurableSessionWriterLease,
  type SessionWriterLeaseOwnerIdentity,
  SessionWriterLeaseHeldError,
  SessionWriterLeaseStorage,
  type SessionWriterLeaseStorageOptions
} from "./session-writer-lease-storage.js";

export interface SessionWriterLeaseReservation {
  readonly token: string;
  readonly taskKey: string;
  readonly sessionPathIdentity: string;
  readonly sessionPathIdentities: readonly string[];
}

interface SessionOwner {
  taskKey: string;
  token?: string;
}

interface ActiveLease {
  identity: CanonicalSessionIdentity;
  locks: Map<string, DurableSessionWriterLease>;
}

interface PendingLease {
  reservation: SessionWriterLeaseReservation;
  requestedPath: string;
  locks: Map<string, DurableSessionWriterLease>;
}

interface CanonicalSessionIdentity {
  primary: string;
  keys: readonly string[];
}

export type CanonicalSessionPath = (
  path: string
) => Promise<string | CanonicalSessionIdentity>;

export interface SessionWriterLeaseRegistryOptions extends SessionWriterLeaseStorageOptions {
  readonly canonicalize?: CanonicalSessionPath;
  readonly storageRoot?: string;
  readonly getOwnerIdentity?: () => SessionWriterLeaseOwnerIdentity;
}

const realpathNative = promisify(realpath.native);

export class SessionWriterLeaseRegistry {
  private readonly activeByTask = new Map<string, ActiveLease>();
  private readonly pendingByTask = new Map<string, PendingLease>();
  private readonly owners = new Map<string, SessionOwner>();
  private readonly canonicalize: CanonicalSessionPath;
  private readonly storage: SessionWriterLeaseStorage | undefined;
  private readonly getOwnerIdentity: () => SessionWriterLeaseOwnerIdentity;
  private compromised = false;

  constructor(private readonly options: SessionWriterLeaseRegistryOptions = {}) {
    this.canonicalize = options.canonicalize ?? canonicalSessionPath;
    this.getOwnerIdentity = options.getOwnerIdentity ?? defaultOwnerIdentity;
    this.storage = options.storageRoot === undefined
      ? undefined
      : new SessionWriterLeaseStorage(options.storageRoot, {
        ...(options.staleMs === undefined ? {} : { staleMs: options.staleMs }),
        ...(options.updateMs === undefined ? {} : { updateMs: options.updateMs }),
        ...(options.metadataHeartbeatMs === undefined
          ? {}
          : { metadataHeartbeatMs: options.metadataHeartbeatMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive }),
        onCompromised: (compromise) => {
          this.compromised = true;
          options.onCompromised?.(compromise);
        }
      });
  }

  async reserve(taskKey: string, sessionPath: string): Promise<SessionWriterLeaseReservation> {
    this.assertHealthy();
    if (this.pendingByTask.has(taskKey)) {
      throw new HostCommandError(
        "BUSY",
        "This Task already has a pending Pi Session transition.",
        true
      );
    }
    const identity = normalizeIdentity(await this.canonicalize(sessionPath));
    this.assertNoConflict(taskKey, identity.keys);
    const reservation: SessionWriterLeaseReservation = {
      token: createMessageId("session-lease"),
      taskKey,
      sessionPathIdentity: identity.primary,
      sessionPathIdentities: identity.keys
    };
    const keysToAcquire = identity.keys.filter((key) => this.owners.get(key)?.taskKey !== taskKey);
    const pending: PendingLease = {
      reservation,
      requestedPath: sessionPath,
      locks: new Map()
    };
    this.pendingByTask.set(taskKey, pending);
    for (const key of keysToAcquire) {
      this.owners.set(key, { taskKey, token: reservation.token });
    }
    try {
      pending.locks = await this.acquireLocks(keysToAcquire, reservation);
      this.assertNoConflict(taskKey, identity.keys);
    } catch (error) {
      this.pendingByTask.delete(taskKey);
      for (const key of keysToAcquire) {
        if (this.owners.get(key)?.token === reservation.token) this.owners.delete(key);
      }
      await this.releaseLocks(pending.locks);
      throw error;
    }
    return reservation;
  }

  async commit(
    reservation: SessionWriterLeaseReservation,
    finalSessionPath?: string
  ): Promise<void> {
    this.assertHealthy();
    const pending = this.assertCurrentReservation(reservation);
    const finalIdentity = normalizeIdentity(
      await this.canonicalize(finalSessionPath ?? pending.requestedPath)
    );
    const nextIdentity = normalizeIdentity({
      primary: finalIdentity.primary,
      keys: [...reservation.sessionPathIdentities, ...finalIdentity.keys]
    });
    this.assertNoConflict(reservation.taskKey, nextIdentity.keys);
    const keysToAcquire = nextIdentity.keys.filter(
      (key) => this.owners.get(key)?.taskKey !== reservation.taskKey
    );
    for (const key of keysToAcquire) {
      this.owners.set(key, { taskKey: reservation.taskKey, token: reservation.token });
    }
    let finalLocks: Map<string, DurableSessionWriterLease>;
    try {
      finalLocks = await this.acquireLocks(keysToAcquire, reservation);
    } catch (error) {
      for (const key of keysToAcquire) {
        if (this.owners.get(key)?.token === reservation.token) this.owners.delete(key);
      }
      throw error;
    }
    const previous = this.activeByTask.get(reservation.taskKey);
    const nextLocks = new Map<string, DurableSessionWriterLease>();
    for (const [key, lock] of previous?.locks ?? []) {
      if (nextIdentity.keys.includes(key)) nextLocks.set(key, lock);
    }
    for (const [key, lock] of pending.locks) nextLocks.set(key, lock);
    for (const [key, lock] of finalLocks) nextLocks.set(key, lock);

    this.pendingByTask.delete(reservation.taskKey);
    this.activeByTask.set(reservation.taskKey, { identity: nextIdentity, locks: nextLocks });
    for (const key of nextIdentity.keys) this.owners.set(key, { taskKey: reservation.taskKey });

    const previousLocks = new Map<string, DurableSessionWriterLease>();
    for (const [key, lock] of previous?.locks ?? []) {
      if (!nextIdentity.keys.includes(key)) {
        previousLocks.set(key, lock);
        if (this.owners.get(key)?.taskKey === reservation.taskKey) this.owners.delete(key);
      }
    }
    await this.releaseLocks(previousLocks);
  }

  async cancel(reservation: SessionWriterLeaseReservation): Promise<void> {
    const pending = this.pendingByTask.get(reservation.taskKey);
    if (pending?.reservation.token !== reservation.token) return;
    this.pendingByTask.delete(reservation.taskKey);
    for (const key of reservation.sessionPathIdentities) {
      const owner = this.owners.get(key);
      if (owner?.token === reservation.token) this.owners.delete(key);
    }
    await this.releaseLocks(pending.locks);
  }

  async releaseTask(taskKey: string): Promise<void> {
    const locks = new Map<string, DurableSessionWriterLease>();
    const pending = this.pendingByTask.get(taskKey);
    if (pending) {
      this.pendingByTask.delete(taskKey);
      for (const [key, lock] of pending.locks) locks.set(key, lock);
    }
    const active = this.activeByTask.get(taskKey);
    if (active) {
      this.activeByTask.delete(taskKey);
      for (const [key, lock] of active.locks) locks.set(key, lock);
    }
    for (const [key, owner] of this.owners) {
      if (owner.taskKey === taskKey) this.owners.delete(key);
    }
    await this.releaseLocks(locks);
  }

  async disposeAll(): Promise<void> {
    const locks = new Map<string, DurableSessionWriterLease>();
    for (const pending of this.pendingByTask.values()) {
      for (const [key, lock] of pending.locks) locks.set(key, lock);
    }
    for (const active of this.activeByTask.values()) {
      for (const [key, lock] of active.locks) locks.set(key, lock);
    }
    this.pendingByTask.clear();
    this.activeByTask.clear();
    this.owners.clear();
    await this.releaseLocks(locks);
  }

  activeIdentityFor(taskKey: string): string | undefined {
    return this.activeByTask.get(taskKey)?.identity.primary;
  }

  diagnostics(): { activeCount: number; pendingCount: number; compromised: boolean } {
    return {
      activeCount: this.activeByTask.size,
      pendingCount: this.pendingByTask.size,
      compromised: this.compromised
    };
  }

  private async acquireLocks(
    keys: readonly string[],
    reservation: SessionWriterLeaseReservation
  ): Promise<Map<string, DurableSessionWriterLease>> {
    const locks = new Map<string, DurableSessionWriterLease>();
    if (!this.storage) return locks;
    try {
      for (const identity of [...new Set(keys)].sort()) {
        const lock = await this.storage.acquire({
          token: reservation.token,
          taskKey: reservation.taskKey,
          identity,
          owner: this.getOwnerIdentity()
        });
        locks.set(identity, lock);
      }
      return locks;
    } catch (error) {
      await this.releaseLocks(locks).catch(() => undefined);
      if (error instanceof SessionWriterLeaseHeldError) throw writerConflict();
      throw writerLeaseUnavailable(error);
    }
  }

  private async releaseLocks(locks: Map<string, DurableSessionWriterLease>): Promise<void> {
    let firstError: unknown;
    for (const lock of [...locks.values()].reverse()) {
      try {
        await lock.release();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) {
      this.compromised = true;
      this.options.onCompromised?.({ identityHash: "release-failed", errorCode: "RELEASE_FAILED" });
      throw writerLeaseUnavailable(firstError);
    }
  }

  private assertNoConflict(taskKey: string, keys: readonly string[]): void {
    const owner = keys
      .map((key) => this.owners.get(key))
      .find((candidate) => candidate !== undefined && candidate.taskKey !== taskKey);
    if (owner) throw writerConflict();
  }

  private assertCurrentReservation(reservation: SessionWriterLeaseReservation): PendingLease {
    const current = this.pendingByTask.get(reservation.taskKey);
    if (current?.reservation.token === reservation.token) return current;
    throw new HostCommandError(
      "STALE_SESSION_GENERATION",
      "The Pi Session writer lease reservation is stale.",
      true
    );
  }

  private assertHealthy(): void {
    if (!this.compromised) return;
    throw writerLeaseUnavailable();
  }
}

async function canonicalSessionPath(path: string): Promise<CanonicalSessionIdentity> {
  const resolved = resolve(path);
  const canonicalPath = await realpathNative(resolved).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!canonicalPath) {
    const pendingKey = await parentLeafIdentity(resolved);
    return { primary: pendingKey, keys: [pendingKey] };
  }
  const metadata = await stat(canonicalPath, { bigint: true });
  const primary = physicalIdentity("session-file-v1", metadata)
    ?? `session-file-path-v1\0${canonicalPath}`;
  const pendingAlias = await parentLeafIdentity(canonicalPath);
  return { primary, keys: [...new Set([primary, pendingAlias])] };
}

async function parentLeafIdentity(path: string): Promise<string> {
  const resolved = resolve(path);
  const canonicalParent = await realpathNative(dirname(resolved)).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!canonicalParent) return `session-pending-path-v1\0${resolved}`;
  const metadata = await stat(canonicalParent, { bigint: true });
  const parent = physicalIdentity("session-parent-v1", metadata)
    ?? `session-parent-path-v1\0${canonicalParent}`;
  return `${parent}\0${basename(resolved)}`;
}

function physicalIdentity(prefix: string, metadata: BigIntStats): string | undefined {
  if (metadata.dev === 0n || metadata.ino === 0n) return undefined;
  return [
    prefix,
    metadata.dev.toString(10),
    metadata.ino.toString(10),
    metadata.birthtimeNs.toString(10)
  ].join("\0");
}

function normalizeIdentity(identity: string | CanonicalSessionIdentity): CanonicalSessionIdentity {
  if (typeof identity === "string") return { primary: identity, keys: [identity] };
  const keys = [...new Set([identity.primary, ...identity.keys])];
  return { primary: identity.primary, keys };
}

function defaultOwnerIdentity(): SessionWriterLeaseOwnerIdentity {
  return {
    appInstanceId: "unbound-app",
    hostInstanceId: `process-${process.pid}`,
    hostEpoch: 0,
    processId: process.pid
  };
}

function writerConflict(): HostCommandError {
  return new HostCommandError(
    "BUSY",
    "This Pi Session is already open in another Task or Agent Host.",
    true,
    { sessionWriterLeaseConflict: true }
  );
}

function writerLeaseUnavailable(cause?: unknown): HostCommandError {
  return new HostCommandError(
    "RUNTIME_POISONED",
    "The Pi Session writer lease could not be established or maintained safely.",
    true,
    {
      hostReplacementRequired: true,
      sessionWriterLeaseUnavailable: true,
      ...(cause instanceof Error && "code" in cause && typeof cause.code === "string"
        ? { errorCode: cause.code }
        : {})
    }
  );
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
