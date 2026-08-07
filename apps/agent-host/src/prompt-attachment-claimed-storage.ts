import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PreparedPromptAttachmentSet } from "@pi67/pi-runtime";
import {
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES
} from "@pi67/protocol";
import {
  assertOpaqueId,
  assertSameAttachment,
  parsePreparedAttachment,
  readPrivateTextFile,
  validateStagedAttachment
} from "./prompt-attachment-payload-storage.js";

export interface ClaimedManifest {
  version: 1;
  submissionKey: string;
  sourceIds: string[];
  claimedAt: number;
  set: PreparedPromptAttachmentSet;
}

export interface ClaimedSetRecord {
  taskKey: string;
  directory: string;
  set: PreparedPromptAttachmentSet;
}

export const MAX_CLAIMED_SETS_PER_TASK = 128;

const STABLE_KEY = /^[a-f0-9]{64}$/u;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TEMPORARY_CLAIM = new RegExp(`^\\.claim-[a-f0-9]{64}-${UUID}$`, "u");
const DISCARDED_CLAIM = new RegExp(`^\\.discard-${UUID}$`, "u");
const MAX_CLAIMED_MANIFEST_BYTES = 64 * 1024;
const MAX_TEMPORARY_CLAIMS_PER_CLEANUP = 32;

export function stableKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function cleanupTemporaryClaimDirectories(taskDirectory: string): Promise<void> {
  const taskState = await lstat(taskDirectory);
  if (taskState.isSymbolicLink() || !taskState.isDirectory()) {
    throw new Error("Claimed attachment Task directory is invalid.");
  }
  const entries = (await readdir(taskDirectory, { withFileTypes: true }))
    .filter((entry) => TEMPORARY_CLAIM.test(entry.name) || DISCARDED_CLAIM.test(entry.name));
  for (const entry of entries.slice(0, MAX_TEMPORARY_CLAIMS_PER_CLEANUP)) {
    if (!entry.isDirectory()) {
      throw new Error("Temporary claimed attachment entry is invalid.");
    }
    const source = join(taskDirectory, entry.name);
    const quarantine = join(taskDirectory, `.discard-${randomUUID()}`);
    try {
      await rename(source, quarantine);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
  }
  if (entries.length > MAX_TEMPORARY_CLAIMS_PER_CLEANUP) {
    throw new Error("Temporary claimed attachment cleanup exceeds the bounded limit.");
  }
}

export async function assertClaimCapacity(
  claimedRoot: string,
  taskKey: string,
  taskDirectory: string
): Promise<void> {
  const entries = await readStableClaimedSetEntries(claimedRoot, taskKey, taskDirectory);
  if (entries.length >= MAX_CLAIMED_SETS_PER_TASK) {
    throw new Error("Claimed attachment Task has reached the bounded set limit.");
  }
}

export async function recoverClaimedRecord(
  claimedRoot: string,
  taskKey: string,
  setId: string
): Promise<ClaimedSetRecord | undefined> {
  const taskDirectory = join(claimedRoot, stableKey(taskKey));
  const taskState = await lstat(taskDirectory).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!taskState) return undefined;
  const entries = await readStableClaimedSetEntries(claimedRoot, taskKey, taskDirectory);
  if (entries.length > MAX_CLAIMED_SETS_PER_TASK) {
    throw new Error("Claimed attachment recovery exceeds the bounded set limit.");
  }
  for (const entry of entries) {
    const directory = join(taskDirectory, entry);
    const candidate = await readClaimedManifest(directory).catch(() => undefined);
    if (!candidate || candidate.set.id !== setId) continue;
    const claimed = await validateClaimedSet(taskDirectory, directory, entry);
    return { taskKey, directory, set: claimed.set };
  }
  return undefined;
}

export async function validateClaimedSet(
  taskDirectory: string,
  directory: string,
  expectedSubmissionKey: string
): Promise<ClaimedManifest> {
  const directoryState = await lstat(directory);
  if (directoryState.isSymbolicLink() || !directoryState.isDirectory()) {
    throw new Error("Claimed attachment directory is invalid.");
  }
  const [canonicalDirectory, canonicalTaskDirectory] = await Promise.all([
    realpath(directory),
    realpath(taskDirectory)
  ]);
  if (canonicalDirectory !== join(canonicalTaskDirectory, expectedSubmissionKey)) {
    throw new Error("Claimed attachment path is not canonical.");
  }
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  if (directoryEntries.length !== 2
    || !directoryEntries.some((entry) => entry.name === "items" && entry.isDirectory())
    || !directoryEntries.some((entry) => entry.name === "set.json" && entry.isFile())) {
    throw new Error("Claimed attachment directory contents are invalid.");
  }
  const claimed = await readClaimedManifest(directory);
  if (claimed.submissionKey !== expectedSubmissionKey) {
    throw new Error("Claimed attachment submission identity is invalid.");
  }
  const itemsRoot = join(directory, "items");
  const itemsState = await lstat(itemsRoot);
  if (itemsState.isSymbolicLink() || !itemsState.isDirectory()
    || await realpath(itemsRoot) !== join(canonicalDirectory, "items")) {
    throw new Error("Claimed attachment items directory is invalid.");
  }
  const itemEntries = await readdir(itemsRoot, { withFileTypes: true });
  if (itemEntries.length !== claimed.sourceIds.length
    || itemEntries.some((entry) => !entry.isDirectory() || !claimed.sourceIds.includes(entry.name))) {
    throw new Error("Claimed attachment items are incomplete.");
  }
  let totalBytes = 0;
  let inlineImageBytes = 0;
  for (const attachment of claimed.set.attachments) {
    const manifest = await validateStagedAttachment(
      itemsRoot,
      join(itemsRoot, attachment.id),
      attachment.id
    );
    assertSameAttachment(attachment, manifest);
    totalBytes += attachment.byteLength;
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("Prompt attachments exceed the 250 MiB per-draft limit.");
    }
    if (attachment.kind === "image") {
      inlineImageBytes += attachment.byteLength;
      if (inlineImageBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
        throw new Error("Inline images exceed the 32 MiB per-prompt limit.");
      }
    }
  }
  return claimed;
}

async function readClaimedManifest(directory: string): Promise<ClaimedManifest> {
  const value = JSON.parse(await readPrivateTextFile(
    join(directory, "set.json"),
    MAX_CLAIMED_MANIFEST_BYTES
  )) as unknown;
  const record = asRecord(value);
  const setRecord = asRecord(record.set);
  assertExactKeys(record, ["version", "submissionKey", "sourceIds", "claimedAt", "set"]);
  assertExactKeys(setRecord, ["id", "attachments"]);
  if (record.version !== 1 || typeof record.submissionKey !== "string"
    || !STABLE_KEY.test(record.submissionKey) || !Array.isArray(record.sourceIds)
    || !Number.isSafeInteger(record.claimedAt) || Number(record.claimedAt) < 0) {
    throw new Error("Claimed attachment manifest is invalid.");
  }
  const attachments = Array.isArray(setRecord.attachments)
    ? setRecord.attachments.map(parsePreparedAttachment)
    : [];
  const setId = assertOpaqueId(setRecord.id);
  const sourceIds = record.sourceIds.map(assertOpaqueId);
  if (sourceIds.length === 0 || sourceIds.length > MAX_PROMPT_ATTACHMENT_COUNT
    || new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("Claimed attachment manifest has invalid source identities.");
  }
  if (attachments.length !== sourceIds.length) {
    throw new Error("Claimed attachment manifest is incomplete.");
  }
  if (attachments.some((attachment, index) => attachment.id !== sourceIds[index])) {
    throw new Error("Claimed attachment manifest identities are inconsistent.");
  }
  return {
    version: 1,
    submissionKey: record.submissionKey,
    sourceIds,
    claimedAt: Number(record.claimedAt),
    set: { id: setId, attachments }
  };
}

async function readStableClaimedSetEntries(
  claimedRoot: string,
  taskKey: string,
  taskDirectory: string
): Promise<string[]> {
  const taskState = await lstat(taskDirectory);
  if (taskState.isSymbolicLink() || !taskState.isDirectory()) {
    throw new Error("Claimed attachment Task directory is invalid.");
  }
  const [canonicalTask, canonicalClaimedRoot] = await Promise.all([
    realpath(taskDirectory),
    realpath(claimedRoot)
  ]);
  if (canonicalTask !== join(canonicalClaimedRoot, stableKey(taskKey))) {
    throw new Error("Claimed attachment Task path is not canonical.");
  }
  const result: string[] = [];
  for (const entry of await readdir(taskDirectory, { withFileTypes: true })) {
    if (STABLE_KEY.test(entry.name)) {
      if (!entry.isDirectory()) throw new Error("Claimed attachment set entry is invalid.");
      result.push(entry.name);
      continue;
    }
    if ((TEMPORARY_CLAIM.test(entry.name) || DISCARDED_CLAIM.test(entry.name)) && entry.isDirectory()) continue;
    throw new Error("Claimed attachment Task directory contains an unexpected entry.");
  }
  return result;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    throw new Error("Claimed attachment manifest is invalid.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
