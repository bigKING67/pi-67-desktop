import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionCreationResolution } from "@pi67/protocol";
import {
  normalizeSessionCatalogPathIdentity,
  resolveExistingSessionFileIdentity
} from "./session-path-identity.js";
import {
  assertSessionCreationId,
  SessionCreationJournal,
  SESSION_CREATION_JOURNAL_VERSION,
  type SessionCreationJournalEntry,
  type SessionCreationJournalOptions,
  type SessionCreationJournalState
} from "./session-creation-journal.js";
import {
  inspectSessionCreationMarker,
  SessionCreationScanBudgetTracker,
  SessionCreationScanLimitError,
  throwIfAborted,
  type SessionCreationIdentity,
  type SessionCreationMarkerInspection,
  type SessionCreationScanBudget
} from "./session-creation-marker-inspection.js";

export {
  appendSessionCreationMarker,
  SESSION_CREATION_MARKER_TYPE
} from "./session-creation-marker-persistence.js";
export type { SessionCreationJournalEntry, SessionCreationJournalState };
export type { SessionCreationScanBudget };

const MAX_FALLBACK_SESSION_FILES = 10_000;
const FALLBACK_SCAN_BATCH_SIZE = 8;

export type SessionCreationMaterializationStart =
  | { status: "started"; creationId: string }
  | Exclude<SessionCreationResolution, { status: "missing" }>;

export interface SessionCreationReceiptStoreOptions extends SessionCreationJournalOptions {
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

export type SessionCreationMaterializedIdentity = SessionCreationIdentity & {
  sessionFileIdentity: string;
};

/** Durable creation journal backed by exact markers in Pi JSONL Sessions. */
export class SessionCreationReceiptStore {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly journal: SessionCreationJournal;

  constructor(private readonly options: SessionCreationReceiptStoreOptions) {
    this.cwd = resolve(options.cwd);
    this.agentDir = resolve(options.agentDir);
    this.journal = new SessionCreationJournal(options);
  }

  async reserve(creationId: string): Promise<SessionCreationJournalEntry> {
    assertSessionCreationId(creationId);
    return this.journal.withLock(creationId, async () => {
      const existing = await this.journal.readUnlocked(creationId);
      if (existing) {
        this.journal.assertWorkspace(existing);
        return existing;
      }
      const now = this.journal.timestamp();
      const entry: SessionCreationJournalEntry = {
        version: SESSION_CREATION_JOURNAL_VERSION,
        creationId,
        workspaceKey: this.journal.workspaceKey,
        state: "reserved",
        createdAt: now,
        updatedAt: now
      };
      await this.journal.writeUnlocked(entry);
      return entry;
    });
  }

  async beginMaterialization(
    creationId: string,
    options: SessionCreationResolutionOptions = {}
  ): Promise<SessionCreationMaterializationStart> {
    assertSessionCreationId(creationId);
    return this.journal.withLock(creationId, async () => {
      throwIfAborted(options.signal);
      let entry = await this.journal.readUnlocked(creationId);
      if (!entry) {
        const now = this.journal.timestamp();
        entry = {
          version: SESSION_CREATION_JOURNAL_VERSION,
          creationId,
          workspaceKey: this.journal.workspaceKey,
          state: "reserved",
          createdAt: now,
          updatedAt: now
        };
        await this.journal.writeUnlocked(entry);
      }
      this.journal.assertWorkspace(entry);
      if (entry.state === "reserved") {
        const resolution = await this.resolveJournalEntryLocked(creationId, entry, options);
        if (resolution.status !== "missing") return resolution;
        await this.journal.writeUnlocked({
          ...entry,
          state: "materializing",
          updatedAt: this.journal.timestamp()
        });
        return { status: "started", creationId };
      }

      const resolution = await this.resolveJournalEntryLocked(creationId, entry, options);
      return resolution.status === "missing"
        ? { status: "ambiguous", creationId }
        : resolution;
    });
  }

  async record(
    creationId: string,
    manager: SessionCreationManager
  ): Promise<SessionCreationMaterializedIdentity> {
    assertSessionCreationId(creationId);
    const sessionPath = manager.getSessionFile();
    if (!sessionPath) throw new Error("The created Pi Session does not have a persisted JSONL path.");
    const inspection = await inspectSessionCreationMarker(sessionPath, creationId, this.cwd);
    if (inspection.status !== "match" || inspection.identity.sessionId !== manager.getSessionId()) {
      throw new Error("The created Pi Session does not contain its exact creation marker.");
    }
    const sessionFileIdentity = await resolveExistingSessionFileIdentity(inspection.identity.sessionPath);
    await this.journal.withLock(creationId, async () => {
      const existing = await this.journal.readUnlocked(creationId);
      if (existing) {
        this.journal.assertWorkspace(existing);
        if (!sameJournalIdentity(existing, inspection.identity, sessionFileIdentity)) {
          await this.journal.writeUnlocked({
            ...existing,
            state: "ambiguous",
            updatedAt: this.journal.timestamp()
          });
          throw new Error("The Session creation id is already bound to another Pi JSONL Session.");
        }
      }
      const now = this.journal.timestamp();
      await this.journal.writeUnlocked({
        version: SESSION_CREATION_JOURNAL_VERSION,
        creationId,
        workspaceKey: this.journal.workspaceKey,
        state: "materialized",
        ...inspection.identity,
        sessionFileIdentity,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    });
    return { ...inspection.identity, sessionFileIdentity };
  }

  async markPublished(creationId: string, identity: SessionCreationIdentity): Promise<void> {
    await this.advancePublishedState(creationId, identity);
  }

  async journalEntry(creationId: string): Promise<SessionCreationJournalEntry | undefined> {
    assertSessionCreationId(creationId);
    return this.journal.withLock(creationId, async () => {
      const entry = await this.journal.readUnlocked(creationId);
      if (!entry || entry.workspaceKey !== this.journal.workspaceKey) return undefined;
      return { ...entry };
    });
  }

  diagnostics() {
    return this.journal.diagnostics();
  }

  async resolve(
    creationId: string,
    options: SessionCreationResolutionOptions = {}
  ): Promise<SessionCreationResolution> {
    try {
      assertSessionCreationId(creationId);
      return await this.journal.withLock(creationId, async () => {
        throwIfAborted(options.signal);
        const entry = await this.journal.readUnlocked(creationId);
        return this.resolveJournalEntryLocked(creationId, entry, options);
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof SessionCreationScanLimitError) {
        return { status: "unavailable", creationId, reason: "scan-limit" };
      }
      return { status: "unavailable", creationId, reason: "storage-error" };
    }
  }

  private async resolveJournalEntryLocked(
    creationId: string,
    entry: SessionCreationJournalEntry | undefined,
    options: SessionCreationResolutionOptions
  ): Promise<SessionCreationResolution> {
    if (entry && entry.workspaceKey !== this.journal.workspaceKey) {
      return { status: "ambiguous", creationId };
    }
    if (entry?.sessionPath) {
      const inspection = await inspectSessionCreationMarker(
        entry.sessionPath,
        creationId,
        this.cwd,
        options.signal === undefined ? {} : { signal: options.signal }
      );
      if (inspection.status === "match") {
        const fileIdentity = await resolveExistingSessionFileIdentity(inspection.identity.sessionPath);
        if (sameJournalIdentity(entry, inspection.identity, fileIdentity)) {
          await this.persistResolvedIdentity(entry, inspection.identity, fileIdentity);
          return materialized(creationId, inspection.identity, fileIdentity);
        }
        await this.persistAmbiguous(entry);
        return { status: "ambiguous", creationId };
      }
      if (inspection.status === "ambiguous") {
        await this.persistAmbiguous(entry);
        return { status: "ambiguous", creationId };
      }
    }

    const scanned = await this.scanSessionDirectories(creationId, options);
    if (scanned.status === "match") {
      const fileIdentity = await resolveExistingSessionFileIdentity(scanned.identity.sessionPath);
      if (entry && !sameJournalIdentity(entry, scanned.identity, fileIdentity)) {
        await this.persistAmbiguous(entry);
        return { status: "ambiguous", creationId };
      }
      const now = this.journal.timestamp();
      const resolvedEntry: SessionCreationJournalEntry = {
        version: SESSION_CREATION_JOURNAL_VERSION,
        creationId,
        workspaceKey: this.journal.workspaceKey,
        state: materializedState(entry?.state),
        ...scanned.identity,
        sessionFileIdentity: fileIdentity,
        createdAt: entry?.createdAt ?? now,
        updatedAt: now
      };
      await this.journal.writeUnlocked(resolvedEntry);
      return materialized(creationId, scanned.identity, fileIdentity);
    }
    if (scanned.status === "unavailable") {
      return { status: "unavailable", creationId, reason: scanned.reason };
    }
    if (scanned.status === "ambiguous") {
      if (entry) await this.persistAmbiguous(entry);
      return { status: "ambiguous", creationId };
    }
    if (!entry || entry.state === "reserved") return { status: "missing", creationId };
    await this.persistAmbiguous(entry);
    return { status: "ambiguous", creationId };
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
          budget.assertAvailable();
          const path = join(directory, entry.name);
          const identity = await resolveExistingSessionFileIdentity(path);
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

  private async advancePublishedState(
    creationId: string,
    identity: SessionCreationIdentity
  ): Promise<void> {
    assertSessionCreationId(creationId);
    const inspection = await inspectSessionCreationMarker(identity.sessionPath, creationId, this.cwd);
    if (inspection.status !== "match" || inspection.identity.sessionId !== identity.sessionId) {
      throw new Error("The Session creation journal cannot advance without an exact JSONL marker.");
    }
    const fileIdentity = await resolveExistingSessionFileIdentity(inspection.identity.sessionPath);
    await this.journal.withLock(creationId, async () => {
      const entry = await this.journal.readUnlocked(creationId);
      if (!entry) throw new Error("The Session creation journal entry is missing.");
      this.journal.assertWorkspace(entry);
      if (!sameJournalIdentity(entry, inspection.identity, fileIdentity)) {
        await this.persistAmbiguous(entry);
        throw new Error("The Session creation journal identity changed before publication.");
      }
      const nextState = entry.state === "acknowledged" ? "acknowledged" : "published";
      await this.journal.writeUnlocked({
        ...entry,
        ...inspection.identity,
        sessionFileIdentity: fileIdentity,
        state: nextState,
        updatedAt: this.journal.timestamp()
      });
    });
  }

  private async persistResolvedIdentity(
    entry: SessionCreationJournalEntry,
    identity: SessionCreationIdentity,
    fileIdentity: string
  ): Promise<void> {
    await this.journal.writeUnlocked({
      ...entry,
      ...identity,
      sessionFileIdentity: fileIdentity,
      state: materializedState(entry.state),
      updatedAt: this.journal.timestamp()
    });
  }

  private async persistAmbiguous(entry: SessionCreationJournalEntry): Promise<void> {
    if (entry.state === "ambiguous") return;
    await this.journal.writeUnlocked({
      ...entry,
      state: "ambiguous",
      updatedAt: this.journal.timestamp()
    });
  }

}

function materialized(
  creationId: string,
  identity: SessionCreationIdentity,
  sessionFileIdentity: string
): SessionCreationResolution {
  return { status: "materialized", creationId, ...identity, sessionFileIdentity };
}

function defaultSessionDirectory(cwd: string, agentDir: string): string {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}

function sameJournalIdentity(
  entry: SessionCreationJournalEntry,
  identity: SessionCreationIdentity,
  fileIdentity: string
): boolean {
  if (entry.sessionId === undefined && entry.sessionPath === undefined) return true;
  if (entry.sessionId !== identity.sessionId) return false;
  if (entry.sessionFileIdentity !== undefined) return entry.sessionFileIdentity === fileIdentity;
  return entry.sessionPath !== undefined
    && normalizeSessionCatalogPathIdentity(entry.sessionPath)
      === normalizeSessionCatalogPathIdentity(identity.sessionPath);
}

function materializedState(
  state: SessionCreationJournalState | undefined
): "materialized" | "published" | "acknowledged" {
  return state === "published" || state === "acknowledged" ? state : "materialized";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
