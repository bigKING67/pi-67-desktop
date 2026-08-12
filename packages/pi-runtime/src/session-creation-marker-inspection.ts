import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";

export const SESSION_CREATION_MARKER_TYPE = "pi67.session-creation";
export const SESSION_CREATION_MARKER_SCHEMA_VERSION = 1;

const MAX_MARKER_SCAN_BYTES = 1024 * 1024;
const MAX_MARKER_SCAN_LINES = 256;
const MAX_TOTAL_SCAN_FILES = 10_000;
const MAX_TOTAL_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_SCAN_DURATION_MS = 10_000;

export interface SessionCreationIdentity {
  sessionId: string;
  sessionPath: string;
}

export type SessionCreationMarkerInspection =
  | { status: "match"; identity: SessionCreationIdentity }
  | { status: "missing" }
  | { status: "ambiguous" };

export interface SessionCreationScanBudget {
  maxFiles?: number;
  maxBytes?: number;
  maxDurationMs?: number;
}

export interface SessionCreationMarkerInspectionOptions {
  signal?: AbortSignal;
  budget?: SessionCreationScanBudgetTracker;
}

export class SessionCreationScanBudgetTracker {
  private readonly maxFiles: number;
  private readonly maxBytes: number;
  private readonly deadlineAt: number;
  private files = 0;
  private bytes = 0;

  constructor(budget: SessionCreationScanBudget = {}) {
    this.maxFiles = boundedLimit(budget.maxFiles, MAX_TOTAL_SCAN_FILES);
    this.maxBytes = boundedLimit(budget.maxBytes, MAX_TOTAL_SCAN_BYTES);
    this.deadlineAt = Date.now() + boundedLimit(
      budget.maxDurationMs,
      MAX_SCAN_DURATION_MS
    );
  }

  reserveFile(): void {
    this.assertAvailable();
    if (this.files >= this.maxFiles) throw new SessionCreationScanLimitError();
    this.files += 1;
  }

  consumeBytes(bytes: number): void {
    this.assertAvailable();
    if (this.bytes + bytes > this.maxBytes) throw new SessionCreationScanLimitError();
    this.bytes += bytes;
  }

  assertAvailable(): void {
    if (Date.now() >= this.deadlineAt) throw new SessionCreationScanLimitError();
  }
}

export class SessionCreationScanLimitError extends Error {
  constructor() {
    super("The Session creation fallback scan exceeded its total budget.");
    this.name = "SessionCreationScanLimitError";
  }
}

export async function inspectSessionCreationMarker(
  sessionPath: string,
  creationId: string,
  expectedCwd: string,
  options: SessionCreationMarkerInspectionOptions = {}
): Promise<SessionCreationMarkerInspection> {
  throwIfAborted(options.signal);
  options.budget?.reserveFile();
  const info = await lstat(sessionPath).catch((error: unknown) => (
    isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
  ));
  throwIfAborted(options.signal);
  if (!info || !info.isFile() || info.isSymbolicLink()) return { status: "missing" };
  const canonicalSessionPath = await realpath(sessionPath);

  let header: { id: string; cwd: string } | undefined;
  let matches = 0;
  let bytes = 0;
  let lines = 0;
  const stream = createReadStream(canonicalSessionPath, {
    encoding: "utf8",
    start: 0,
    end: MAX_MARKER_SCAN_BYTES - 1,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      throwIfAborted(options.signal);
      lines += 1;
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;
      bytes += lineBytes;
      options.budget?.consumeBytes(lineBytes);
      if (lines > MAX_MARKER_SCAN_LINES || bytes > MAX_MARKER_SCAN_BYTES) break;
      let entry: unknown;
      try {
        entry = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(entry)) continue;
      if (
        entry.type === "session"
        && typeof entry.id === "string"
        && typeof entry.cwd === "string"
      ) {
        header ??= { id: entry.id, cwd: entry.cwd };
        continue;
      }
      if (
        entry.type === "custom"
        && entry.customType === SESSION_CREATION_MARKER_TYPE
        && isRecord(entry.data)
        && entry.data.schemaVersion === SESSION_CREATION_MARKER_SCHEMA_VERSION
        && entry.data.creationId === creationId
      ) {
        matches += 1;
      }
    }
  } finally {
    input.close();
    stream.destroy();
  }
  if (matches > 1) return { status: "ambiguous" };
  if (
    matches !== 1
    || !header
    || normalizeSessionCatalogWorkspaceIdentity(header.cwd)
      !== normalizeSessionCatalogWorkspaceIdentity(expectedCwd)
  ) return { status: "missing" };
  return {
    status: "match",
    identity: { sessionId: header.id, sessionPath: canonicalSessionPath }
  };
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The Session creation resolution was cancelled.", "AbortError");
}

function boundedLimit(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
