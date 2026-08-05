import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionCreationResolution } from "@pi67/protocol";
import {
  createPrivateFileAtomically,
  withConfigurationFileLock,
  writePrivateFileAtomically
} from "./atomic-private-file.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import {
  inspectSessionCreationMarker,
  SESSION_CREATION_MARKER_SCHEMA_VERSION,
  SESSION_CREATION_MARKER_TYPE,
  SessionCreationScanBudgetTracker,
  SessionCreationScanLimitError,
  throwIfAborted,
  type SessionCreationIdentity,
  type SessionCreationMarkerInspection,
  type SessionCreationScanBudget
} from "./session-creation-marker-inspection.js";

export { SESSION_CREATION_MARKER_TYPE };
export type { SessionCreationScanBudget };

const RECEIPT_VERSION = 1;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_FALLBACK_SESSION_FILES = 10_000;
const FALLBACK_SCAN_BATCH_SIZE = 8;

interface SessionCreationReceipt {
  version: typeof RECEIPT_VERSION;
  creationId: string;
  workspaceKey: string;
  sessionId: string;
  sessionPath: string;
}

export interface SessionCreationReceiptStoreOptions {
  cwd: string;
  agentDir: string;
  storageRoot?: string;
  getConfiguredSessionDir(): string | undefined;
}

export interface SessionCreationResolutionOptions {
  signal?: AbortSignal;
  scanBudget?: SessionCreationScanBudget;
}

export type SessionCreationManager = Pick<
  SessionManager,
  "getCwd" | "getSessionId" | "getSessionFile"
>;

/** Disposable receipt cache backed by exact markers in Pi JSONL Sessions. */
export class SessionCreationReceiptStore {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly workspaceKey: string;
  private readonly receiptDirectory: string | undefined;

  constructor(private readonly options: SessionCreationReceiptStoreOptions) {
    this.cwd = resolve(options.cwd);
    this.agentDir = resolve(options.agentDir);
    this.workspaceKey = createHash("sha256")
      .update(normalizeSessionCatalogPathIdentity(this.cwd))
      .update("\0")
      .update(normalizeSessionCatalogPathIdentity(this.agentDir))
      .digest("hex");
    this.receiptDirectory = options.storageRoot === undefined
      ? undefined
      : join(options.storageRoot, "session-creation-receipts-v1");
  }

  async record(creationId: string, manager: SessionCreationManager): Promise<SessionCreationIdentity> {
    const sessionPath = manager.getSessionFile();
    if (!sessionPath) throw new Error("The created Pi Session does not have a persisted JSONL path.");
    const inspection = await inspectSessionCreationMarker(sessionPath, creationId, this.cwd);
    if (inspection.status !== "match" || inspection.identity.sessionId !== manager.getSessionId()) {
      throw new Error("The created Pi Session does not contain its exact creation marker.");
    }
    await this.persistReceipt({
      version: RECEIPT_VERSION,
      creationId,
      workspaceKey: this.workspaceKey,
      ...inspection.identity
    });
    return inspection.identity;
  }

  async resolve(
    creationId: string,
    options: SessionCreationResolutionOptions = {}
  ): Promise<SessionCreationResolution> {
    try {
      throwIfAborted(options.signal);
      const receipt = await this.readReceipt(creationId);
      if (receipt?.workspaceKey === this.workspaceKey) {
        const inspection = await inspectSessionCreationMarker(
          receipt.sessionPath,
          creationId,
          this.cwd,
          options.signal === undefined ? {} : { signal: options.signal }
        );
        if (
          inspection.status === "match"
          && inspection.identity.sessionId === receipt.sessionId
        ) {
          return materialized(creationId, inspection.identity);
        }
        if (inspection.status === "ambiguous") return { status: "ambiguous", creationId };
      }

      const scanned = await this.scanSessionDirectories(creationId, options);
      if (scanned.status !== "match") {
        return scanned.status === "ambiguous"
          ? { status: "ambiguous", creationId }
          : scanned.status === "unavailable"
            ? { status: "unavailable", creationId, reason: scanned.reason }
            : { status: "missing", creationId };
      }
      await this.persistReceipt({
        version: RECEIPT_VERSION,
        creationId,
        workspaceKey: this.workspaceKey,
        ...scanned.identity
      }).catch(() => undefined);
      return materialized(creationId, scanned.identity);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof SessionCreationScanLimitError) {
        return { status: "unavailable", creationId, reason: "scan-limit" };
      }
      return { status: "unavailable", creationId, reason: "storage-error" };
    }
  }

  private async scanSessionDirectories(
    creationId: string,
    options: SessionCreationResolutionOptions
  ): Promise<
    SessionCreationMarkerInspection
      | { status: "unavailable"; reason: "scan-limit" | "storage-error" }
  > {
    const paths: string[] = [];
    const seen = new Set<string>();
    const budget = new SessionCreationScanBudgetTracker(options.scanBudget);
    try {
      for (const directory of this.sessionDirectories()) {
        throwIfAborted(options.signal);
        budget.assertAvailable();
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if (isNodeError(error, "ENOENT")) return [];
          throw error;
        });
        throwIfAborted(options.signal);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          const path = join(directory, entry.name);
          const identity = normalizeSessionCatalogPathIdentity(path);
          if (seen.has(identity)) continue;
          seen.add(identity);
          paths.push(path);
          if (paths.length > MAX_FALLBACK_SESSION_FILES) {
            return { status: "unavailable", reason: "scan-limit" };
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof SessionCreationScanLimitError) {
        return { status: "unavailable", reason: "scan-limit" };
      }
      return { status: "unavailable", reason: "storage-error" };
    }

    let match: SessionCreationIdentity | undefined;
    try {
      for (let offset = 0; offset < paths.length; offset += FALLBACK_SCAN_BATCH_SIZE) {
        throwIfAborted(options.signal);
        budget.assertAvailable();
        const batch = paths.slice(offset, offset + FALLBACK_SCAN_BATCH_SIZE);
        const inspections = await Promise.all(batch.map((path) => (
          inspectSessionCreationMarker(path, creationId, this.cwd, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            budget
          })
        )));
        for (const inspection of inspections) {
          if (inspection.status === "ambiguous") return inspection;
          if (inspection.status !== "match") continue;
          if (match) return { status: "ambiguous" };
          match = inspection.identity;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return error instanceof SessionCreationScanLimitError
        ? { status: "unavailable", reason: "scan-limit" }
        : { status: "unavailable", reason: "storage-error" };
    }
    return match ? { status: "match", identity: match } : { status: "missing" };
  }

  private sessionDirectories(): string[] {
    const configured = this.options.getConfiguredSessionDir();
    const directories = [
      ...(configured ? [resolve(configured)] : []),
      defaultSessionDirectory(this.cwd, this.agentDir)
    ];
    return [...new Map(directories.map((path) => [
      normalizeSessionCatalogPathIdentity(path),
      path
    ])).values()];
  }

  private async readReceipt(creationId: string): Promise<SessionCreationReceipt | undefined> {
    const path = this.receiptPath(creationId);
    if (!path) return undefined;
    const info = await lstat(path).catch((error: unknown) => (
      isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
    ));
    if (!info) return undefined;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_RECEIPT_BYTES) {
      await quarantine(path);
      return undefined;
    }
    try {
      if (process.platform !== "win32") await chmod(path, 0o600);
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!isReceipt(parsed) || parsed.creationId !== creationId) throw new Error("Invalid receipt.");
      return parsed;
    } catch {
      await quarantine(path);
      return undefined;
    }
  }

  private async persistReceipt(receipt: SessionCreationReceipt): Promise<void> {
    const path = this.receiptPath(receipt.creationId);
    if (!path) return;
    await mkdir(this.receiptDirectory!, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.receiptDirectory!, 0o700);
    await withConfigurationFileLock(path, async () => {
      const existing = await this.readReceipt(receipt.creationId);
      if (existing) {
        if (
          existing.workspaceKey === receipt.workspaceKey
          && existing.sessionId === receipt.sessionId
          && normalizeSessionCatalogPathIdentity(existing.sessionPath)
            === normalizeSessionCatalogPathIdentity(receipt.sessionPath)
        ) return;
        const inspection = await inspectSessionCreationMarker(
          existing.sessionPath,
          receipt.creationId,
          this.cwd
        );
        if (inspection.status === "match" || inspection.status === "ambiguous") {
          throw new Error("The Session creation id is already bound to another Pi JSONL Session.");
        }
      }
      const serialized = `${JSON.stringify(receipt)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
        throw new Error("The Session creation receipt exceeds its storage limit.");
      }
      await writePrivateFileAtomically(path, serialized);
      if (process.platform !== "win32") await chmod(path, 0o600);
    });
  }

  private receiptPath(creationId: string): string | undefined {
    if (!this.receiptDirectory) return undefined;
    const name = createHash("sha256").update(creationId, "utf8").digest("hex");
    return join(this.receiptDirectory, `${name}.json`);
  }
}

export async function appendSessionCreationMarker(
  manager: Pick<
    SessionManager,
    | "appendCustomEntry"
    | "getCwd"
    | "getEntries"
    | "getHeader"
    | "getSessionId"
    | "getSessionFile"
    | "isPersisted"
    | "setSessionFile"
  >,
  creationId: string
): Promise<void> {
  manager.appendCustomEntry(SESSION_CREATION_MARKER_TYPE, {
    schemaVersion: SESSION_CREATION_MARKER_SCHEMA_VERSION,
    creationId
  });
  if (!manager.isPersisted()) return;

  const sessionPath = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionPath || !header) {
    throw new Error("The created Pi Session cannot persist its creation marker.");
  }
  const existing = await lstat(sessionPath).catch((error: unknown) => (
    isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
  ));
  if (existing) {
    const inspection = await inspectSessionCreationMarker(
      sessionPath,
      creationId,
      manager.getCwd()
    );
    if (
      inspection.status !== "match"
      || inspection.identity.sessionId !== manager.getSessionId()
    ) {
      throw new Error("The existing Pi Session does not contain its exact creation marker.");
    }
    manager.setSessionFile(inspection.identity.sessionPath);
    return;
  }
  const serialized = [header, ...manager.getEntries()]
    .map((entry) => JSON.stringify(entry))
    .join("\n") + "\n";
  await createPrivateFileAtomically(sessionPath, serialized);

  // Pi normally defers the first JSONL write until an assistant message exists.
  // Reloading the exact file marks this manager as flushed so future entries append safely.
  const inspection = await inspectSessionCreationMarker(
    sessionPath,
    creationId,
    manager.getCwd()
  );
  if (
    inspection.status !== "match"
    || inspection.identity.sessionId !== manager.getSessionId()
  ) {
    throw new Error("The persisted Pi Session does not contain its exact creation marker.");
  }
  manager.setSessionFile(inspection.identity.sessionPath);
}

function materialized(
  creationId: string,
  identity: SessionCreationIdentity
): SessionCreationResolution {
  return { status: "materialized", creationId, ...identity };
}

function defaultSessionDirectory(cwd: string, agentDir: string): string {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}

function isReceipt(value: unknown): value is SessionCreationReceipt {
  return isRecord(value)
    && value.version === RECEIPT_VERSION
    && typeof value.creationId === "string"
    && /^[A-Za-z0-9_-]{1,128}$/u.test(value.creationId)
    && typeof value.workspaceKey === "string"
    && /^[0-9a-f]{64}$/u.test(value.workspaceKey)
    && typeof value.sessionId === "string"
    && value.sessionId.length > 0
    && value.sessionId.length <= 1_024
    && typeof value.sessionPath === "string"
    && value.sessionPath.length > 0
    && value.sessionPath.length <= 32_768;
}

async function quarantine(path: string): Promise<void> {
  await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
