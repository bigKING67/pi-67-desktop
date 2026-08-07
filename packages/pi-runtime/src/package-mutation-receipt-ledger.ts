import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import type {
  ExtensionPackageReceiptState,
  ExtensionPackageScope,
  PackageSourceKind
} from "@pi67/domain";
import { RuntimeError } from "@pi67/domain";
import { safeAtomicReplaceFile } from "./safe-atomic-io.js";

const PACKAGE_RECEIPT_VERSION = 1;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const MAX_LEDGER_RECORDS = 512;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type PackageReceiptOperation = "install" | "update" | "uninstall";
export type DurablePackageReceiptState = Exclude<ExtensionPackageReceiptState, "not-applicable">
  | "reserved"
  | "mutating";

export interface ExtensionPackageObservation {
  packageName?: string;
  packageVersion?: string;
  manifestSha256: string;
  contentSha256: string;
  directoryIdentityDigest: string;
  observedAt: number;
}

export interface PackageMutationReceiptRecord {
  recordKey: string;
  sourceDigest: string;
  scope: ExtensionPackageScope;
  sourceKind: Exclude<PackageSourceKind, "bundled">;
  state: DurablePackageReceiptState;
  lastOperation: PackageReceiptOperation;
  mutationKeyDigest: string;
  fingerprintDigest: string;
  startedAt: number;
  completedAt?: number;
  changed?: boolean;
  observation?: ExtensionPackageObservation;
}

export interface PackageMutationReceiptLedger {
  version: 1;
  ownerKey: string;
  records: PackageMutationReceiptRecord[];
}

export async function readPackageReceiptLedger(
  path: string,
  ownerKey: string
): Promise<PackageMutationReceiptLedger | undefined> {
  const info = await lstat(path).catch((error: unknown) => (
    nodeErrorCode(error) === "ENOENT" ? undefined : Promise.reject(error)
  ));
  if (!info) return undefined;
  assertSafeLedgerMetadata(info);
  const value = await readFile(path, "utf8").then(parseJson, () => { throw packageReceiptIntegrityError(); });
  if (!isPackageMutationReceiptLedger(value, ownerKey)) throw packageReceiptIntegrityError();
  return structuredClone(value);
}

export function readPackageReceiptLedgerSync(
  path: string,
  ownerKey: string
): PackageMutationReceiptLedger | undefined {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  assertSafeLedgerMetadata(info);
  const value = parseJson(readFileSync(path, "utf8"));
  if (!isPackageMutationReceiptLedger(value, ownerKey)) throw packageReceiptIntegrityError();
  return structuredClone(value);
}

export async function writePackageReceiptLedger(
  path: string,
  ledger: PackageMutationReceiptLedger
): Promise<void> {
  if (!isPackageMutationReceiptLedger(ledger, ledger.ownerKey)) throw packageReceiptIntegrityError();
  const serialized = `${JSON.stringify(ledger)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LEDGER_BYTES) throw packageReceiptIntegrityError();
  await safeAtomicReplaceFile(path, serialized, { mode: PRIVATE_FILE_MODE });
}

export async function ensurePackageReceiptDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw packageReceiptIntegrityError();
  if (process.platform !== "win32") await chmod(path, PRIVATE_DIRECTORY_MODE);
}

export function isPackageMutationReceiptRecord(
  value: unknown,
  ownerKey: string
): value is PackageMutationReceiptRecord {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "recordKey",
    "sourceDigest",
    "scope",
    "sourceKind",
    "state",
    "lastOperation",
    "mutationKeyDigest",
    "fingerprintDigest",
    "startedAt",
    "completedAt",
    "changed",
    "observation"
  ])) return false;
  if (
    !isSha256(value.recordKey)
    || !isSha256(value.sourceDigest)
    || (value.scope !== "global" && value.scope !== "project")
    || (value.sourceKind !== "npm" && value.sourceKind !== "git" && value.sourceKind !== "path")
    || !isReceiptState(value.state)
    || !isReceiptOperation(value.lastOperation)
    || !isSha256(value.mutationKeyDigest)
    || !isSha256(value.fingerprintDigest)
    || !isTimestamp(value.startedAt)
    || (value.completedAt !== undefined && !isTimestamp(value.completedAt))
    || (value.changed !== undefined && typeof value.changed !== "boolean")
    || (value.observation !== undefined && !isObservation(value.observation))
  ) return false;
  if (value.recordKey !== packageReceiptRecordKey(ownerKey, value.scope, value.sourceDigest)) return false;
  if (value.completedAt !== undefined && value.completedAt < value.startedAt) return false;
  if (value.state === "active") {
    return value.observation !== undefined
      && value.completedAt !== undefined
      && typeof value.changed === "boolean";
  }
  if (value.state === "removed") return value.completedAt !== undefined && typeof value.changed === "boolean";
  if (value.state === "ambiguous") return value.completedAt !== undefined;
  return value.completedAt === undefined && value.observation === undefined && value.changed === undefined;
}

export function assertPackageObservation(value: ExtensionPackageObservation): void {
  if (!isObservation(value)) throw packageReceiptIntegrityError();
}

export function upsertPackageReceiptRecord(
  ledger: PackageMutationReceiptLedger,
  record: PackageMutationReceiptRecord
): void {
  const index = ledger.records.findIndex((candidate) => candidate.recordKey === record.recordKey);
  if (index !== -1) {
    ledger.records[index] = record;
    return;
  }
  while (ledger.records.length >= MAX_LEDGER_RECORDS) {
    const removable = ledger.records
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => candidate.state === "removed")
      .sort((left, right) => (left.candidate.completedAt ?? 0) - (right.candidate.completedAt ?? 0))[0];
    if (!removable) throw new RuntimeError(
      "RESOURCE_LIMIT_EXCEEDED",
      "The durable Extension package receipt ledger is full."
    );
    ledger.records.splice(removable.candidateIndex, 1);
  }
  ledger.records.push(record);
}

export function packageReceiptRecordKey(
  ownerKey: string,
  scope: ExtensionPackageScope,
  digest: string
): string {
  return packageReceiptSha256(`${ownerKey}\0${scope}\0${digest}`);
}

export function sourceDigest(source: string): string {
  const normalized = source.trim();
  if (!normalized || normalized.includes("\0") || normalized.length > 4_096) {
    throw packageReceiptIntegrityError();
  }
  return packageReceiptSha256(normalized);
}

export function packageReceiptSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function packageReceiptIntegrityError(): RuntimeError {
  return new RuntimeError(
    "PACKAGE_INTEGRITY_MISMATCH",
    "The durable Extension package receipt failed integrity validation.",
    { recoverable: false }
  );
}

function assertSafeLedgerMetadata(info: import("node:fs").Stats): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_LEDGER_BYTES) {
    throw packageReceiptIntegrityError();
  }
}

function isPackageMutationReceiptLedger(
  value: unknown,
  ownerKey: string
): value is PackageMutationReceiptLedger {
  return isRecord(value)
    && hasOnlyKeys(value, ["version", "ownerKey", "records"])
    && value.version === PACKAGE_RECEIPT_VERSION
    && value.ownerKey === ownerKey
    && Array.isArray(value.records)
    && value.records.length <= MAX_LEDGER_RECORDS
    && value.records.every((record) => isPackageMutationReceiptRecord(record, ownerKey))
    && new Set(value.records.map((record) => record.recordKey)).size === value.records.length;
}

function isObservation(value: unknown): value is ExtensionPackageObservation {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "packageName",
      "packageVersion",
      "manifestSha256",
      "contentSha256",
      "directoryIdentityDigest",
      "observedAt"
    ])
    && (value.packageName === undefined || isBoundedText(value.packageName, 200))
    && (value.packageVersion === undefined || isBoundedText(value.packageVersion, 100))
    && isSha256(value.manifestSha256)
    && isSha256(value.contentSha256)
    && isSha256(value.directoryIdentityDigest)
    && isTimestamp(value.observedAt);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw packageReceiptIntegrityError();
  }
}

function isReceiptState(value: unknown): value is DurablePackageReceiptState {
  return value === "reserved"
    || value === "mutating"
    || value === "active"
    || value === "removed"
    || value === "ambiguous";
}

function isReceiptOperation(value: unknown): value is PackageReceiptOperation {
  return value === "install" || value === "update" || value === "uninstall";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
