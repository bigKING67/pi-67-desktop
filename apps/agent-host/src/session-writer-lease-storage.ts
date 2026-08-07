import { createHash } from "node:crypto";
import { chmod, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";

const LEASE_DIRECTORY = "session-writer-leases-v1";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_UPDATE_MS = 10_000;

export interface SessionWriterLeaseOwnerIdentity {
  readonly appInstanceId: string;
  readonly hostInstanceId: string;
  readonly hostEpoch: number;
  readonly processId?: number;
}

export interface SessionWriterLeaseStorageContext {
  readonly token: string;
  readonly taskKey: string;
  readonly identity: string;
  readonly owner: SessionWriterLeaseOwnerIdentity;
}

interface SessionWriterLeaseCompromise {
  readonly identityHash: string;
  readonly errorCode: string;
}

export interface SessionWriterLeaseStorageOptions {
  readonly staleMs?: number;
  readonly updateMs?: number;
  readonly metadataHeartbeatMs?: number;
  readonly now?: () => number;
  readonly isProcessAlive?: (processId: number) => boolean;
  readonly onCompromised?: (compromise: SessionWriterLeaseCompromise) => void;
}

export interface DurableSessionWriterLease {
  readonly identity: string;
  readonly identityHash: string;
  release(): Promise<void>;
}

interface SessionWriterLeaseMetadata {
  readonly version: 1;
  readonly token: string;
  readonly appInstanceId: string;
  readonly hostInstanceId: string;
  readonly hostEpoch: number;
  readonly processId: number;
  readonly taskKeyHash: string;
  readonly sessionIdentityHash: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
}

export class SessionWriterLeaseHeldError extends Error {
  readonly code = "SESSION_WRITER_LEASE_HELD";

  constructor() {
    super("The Pi Session writer lease is already held.");
    this.name = "SessionWriterLeaseHeldError";
  }
}

export class SessionWriterLeaseStorage {
  private readonly staleMs: number;
  private readonly updateMs: number;
  private readonly metadataHeartbeatMs: number;
  private readonly now: () => number;
  private readonly isProcessAlive: (processId: number) => boolean;

  constructor(
    private readonly storageRoot: string,
    private readonly options: SessionWriterLeaseStorageOptions = {}
  ) {
    this.staleMs = boundedDuration(options.staleMs, DEFAULT_STALE_MS, 2_000, 300_000);
    this.updateMs = boundedDuration(
      options.updateMs,
      Math.min(DEFAULT_UPDATE_MS, Math.floor(this.staleMs / 2)),
      1_000,
      Math.floor(this.staleMs / 2)
    );
    this.metadataHeartbeatMs = boundedDuration(
      options.metadataHeartbeatMs,
      this.updateMs,
      1_000,
      this.staleMs
    );
    this.now = options.now ?? Date.now;
    this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
  }

  async acquire(context: SessionWriterLeaseStorageContext): Promise<DurableSessionWriterLease> {
    const identityHash = hashPrivateValue(context.identity);
    const metadataPath = sessionWriterLeaseMetadataPath(this.storageRoot, identityHash);
    await mkdir(join(this.storageRoot, LEASE_DIRECTORY), {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE
    });

    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatWrite = Promise.resolve();
    const acquiredAt = this.now();
    const metadata = (heartbeatAt: number): SessionWriterLeaseMetadata => ({
      version: 1,
      token: context.token,
      appInstanceId: context.owner.appInstanceId,
      hostInstanceId: context.owner.hostInstanceId,
      hostEpoch: context.owner.hostEpoch,
      processId: context.owner.processId ?? process.pid,
      taskKeyHash: hashPrivateValue(context.taskKey),
      sessionIdentityHash: identityHash,
      acquiredAt,
      heartbeatAt
    });
    const compromise = (error: unknown): void => {
      if (stopped) return;
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      this.options.onCompromised?.({
        identityHash,
        errorCode: nodeErrorCode(error)
      });
    };

    const lockOptions = {
      realpath: false,
      retries: 0,
      stale: this.staleMs,
      update: this.updateMs,
      onCompromised: compromise
    } as const;
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await lockfile.lock(metadataPath, lockOptions);
    } catch (error) {
      if (nodeErrorCode(error) !== "ELOCKED") throw error;
      const reclaimed = await this.reclaimDeadOwner(metadataPath, identityHash);
      if (!reclaimed) throw new SessionWriterLeaseHeldError();
      try {
        releaseLock = await lockfile.lock(metadataPath, lockOptions);
      } catch (retryError) {
        if (nodeErrorCode(retryError) === "ELOCKED") throw new SessionWriterLeaseHeldError();
        throw retryError;
      }
    }

    try {
      await writePrivateMetadata(metadataPath, metadata(acquiredAt));
    } catch (error) {
      await releaseLock().catch(() => undefined);
      throw error;
    }

    heartbeatTimer = setInterval(() => {
      heartbeatWrite = heartbeatWrite.then(
        () => writePrivateMetadata(metadataPath, metadata(this.now()))
      ).catch((error: unknown) => compromise(error));
    }, this.metadataHeartbeatMs);
    heartbeatTimer.unref?.();

    return {
      identity: context.identity,
      identityHash,
      release: async () => {
        if (stopped) return;
        stopped = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
        await heartbeatWrite;
        // Remove owner metadata while the lock is still held so an old owner cannot delete a successor's record.
        await unlink(metadataPath).catch((error: unknown) => {
          if (nodeErrorCode(error) !== "ENOENT") throw error;
        });
        await releaseLock!();
      }
    };
  }

  private async reclaimDeadOwner(metadataPath: string, identityHash: string): Promise<boolean> {
    const metadata = await readPrivateMetadata(metadataPath, identityHash);
    if (!metadata || this.isProcessAlive(metadata.processId)) return false;
    try {
      await unlink(metadataPath);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return false;
      throw error;
    }
    await rmdir(`${metadataPath}.lock`).catch((error: unknown) => {
      if (nodeErrorCode(error) !== "ENOENT") throw error;
    });
    return true;
  }
}

export function sessionWriterLeaseMetadataPath(storageRoot: string, identityHash: string): string {
  return join(storageRoot, LEASE_DIRECTORY, `${identityHash}.json`);
}

export function hashPrivateValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writePrivateMetadata(
  path: string,
  metadata: SessionWriterLeaseMetadata
): Promise<void> {
  const handle = await open(path, "w", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, PRIVATE_FILE_MODE);
}

async function readPrivateMetadata(
  path: string,
  expectedIdentityHash: string
): Promise<SessionWriterLeaseMetadata | undefined> {
  const handle = await open(path, "r").catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!handle) return undefined;
  try {
    const metadata = JSON.parse(await handle.readFile("utf8")) as Partial<SessionWriterLeaseMetadata>;
    if (
      metadata.version !== 1
      || !Number.isSafeInteger(metadata.processId)
      || Number(metadata.processId) <= 0
      || metadata.sessionIdentityHash !== expectedIdentityHash
    ) return undefined;
    return metadata as SessionWriterLeaseMetadata;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  } finally {
    await handle.close();
  }
}

function processIsAlive(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Duration must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
