import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface PromptAttachmentStaleRunCleanupResult {
  removedRunCount: number;
  skippedRunCount: number;
  errorCount: number;
  errorClasses: string[];
}

export interface PromptAttachmentStaleRunCleanupOptions {
  now?: number;
  staleAfterMs?: number;
  maximumRuns?: number;
  createQuarantineId?: () => string;
}

const PROMPT_ATTACHMENT_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_STALE_RUN_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_STALE_RUNS_PER_CLEANUP = 16;
const MAX_CLEANUP_ERROR_CLASSES = 4;

export async function cleanupStalePromptAttachmentRuns(
  parentRoot: string,
  currentAppInstanceId: string,
  options: PromptAttachmentStaleRunCleanupOptions = {}
): Promise<PromptAttachmentStaleRunCleanupResult> {
  const result: PromptAttachmentStaleRunCleanupResult = {
    removedRunCount: 0,
    skippedRunCount: 0,
    errorCount: 0,
    errorClasses: []
  };
  const root = resolve(parentRoot);
  const now = options.now ?? Date.now();
  const staleAfterMs = boundedCleanupLimit(options.staleAfterMs, DEFAULT_STALE_RUN_AGE_MS);
  const maximumRuns = Math.floor(boundedCleanupLimit(
    options.maximumRuns,
    MAX_STALE_RUNS_PER_CLEANUP
  ));
  const createQuarantineId = options.createQuarantineId ?? randomUUID;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return result;
    recordCleanupError(result, error);
    return result;
  }

  const candidates: Array<{ name: string; modifiedAt: number }> = [];
  for (const entry of entries) {
    if (entry.name === currentAppInstanceId || !PROMPT_ATTACHMENT_RUN_ID.test(entry.name)) {
      result.skippedRunCount += 1;
      continue;
    }
    try {
      const metadata = await lstat(join(root, entry.name));
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        result.skippedRunCount += 1;
        continue;
      }
      if (now - metadata.mtimeMs < staleAfterMs) {
        result.skippedRunCount += 1;
        continue;
      }
      candidates.push({ name: entry.name, modifiedAt: metadata.mtimeMs });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      recordCleanupError(result, error);
    }
  }

  candidates.sort((left, right) => left.modifiedAt - right.modifiedAt);
  for (const candidate of candidates.slice(0, maximumRuns)) {
    const source = join(root, candidate.name);
    const quarantineId = createQuarantineId();
    if (!PROMPT_ATTACHMENT_RUN_ID.test(quarantineId) || quarantineId === currentAppInstanceId) {
      recordCleanupError(result, new Error("Invalid cleanup quarantine id."));
      continue;
    }
    const quarantine = join(root, quarantineId);
    try {
      await rename(source, quarantine);
      const quarantined = await lstat(quarantine);
      if (quarantined.isSymbolicLink() || !quarantined.isDirectory()) {
        result.skippedRunCount += 1;
        continue;
      }
      await rm(quarantine, { recursive: true, force: true });
      result.removedRunCount += 1;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      recordCleanupError(result, error);
    }
  }
  return result;
}

function boundedCleanupLimit(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, value));
}

function recordCleanupError(result: PromptAttachmentStaleRunCleanupResult, error: unknown): void {
  result.errorCount += 1;
  const errorClass = cleanupErrorClass(error);
  if (
    result.errorClasses.length < MAX_CLEANUP_ERROR_CLASSES
    && !result.errorClasses.includes(errorClass)
  ) result.errorClasses.push(errorClass);
}

function cleanupErrorClass(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : "NODE_ERROR";
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)) return error.name;
  return "UnknownError";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
