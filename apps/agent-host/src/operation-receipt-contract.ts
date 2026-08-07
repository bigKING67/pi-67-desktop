import { createHash } from "node:crypto";
import type { OperationKind } from "@pi67/domain";
import type { OperationAccepted, OperationSettled, ProtocolError } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

const OPERATION_RECEIPT_VERSION = 1;
const OPERATION_RECEIPT_LEDGER_VERSION = 1;
export const MAX_OPERATION_RECEIPTS = 512;

export interface OperationReceiptScope {
  workspaceId: string;
  taskId: string;
  taskGeneration: number;
}

interface OperationReceiptAuthority {
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
}

type OperationReceiptStage = "accepted" | "running" | "settled";

export interface OperationReceiptRecord {
  version: typeof OPERATION_RECEIPT_VERSION;
  submissionId: string;
  fingerprint: string;
  operationId: string;
  operationKind: OperationKind;
  cancellable: boolean;
  acceptedHostEpoch: number;
  authority: OperationReceiptAuthority;
  startedAt: number;
  stage: OperationReceiptStage;
  terminal?: OperationSettled;
  createdAt: number;
  updatedAt: number;
}

export interface OperationReceiptLedger {
  version: typeof OPERATION_RECEIPT_LEDGER_VERSION;
  scopeKey: string;
  records: OperationReceiptRecord[];
}

export interface RememberOperationAcceptedInput {
  submissionId: string;
  fingerprint: string;
  operationKind: OperationKind;
  startedAt: number;
  accepted: OperationAccepted;
}

export interface RememberOperationAcceptedResult {
  created: boolean;
  record: OperationReceiptRecord;
}

export function operationReceiptScopeKey(scope: OperationReceiptScope): string {
  assertReceiptScope(scope);
  return createHash("sha256")
    .update(JSON.stringify([scope.workspaceId, scope.taskId, scope.taskGeneration]), "utf8")
    .digest("hex");
}

export function emptyOperationReceiptLedger(scopeKey: string): OperationReceiptLedger {
  return { version: OPERATION_RECEIPT_LEDGER_VERSION, scopeKey, records: [] };
}

export function createAcceptedOperationReceipt(
  input: RememberOperationAcceptedInput,
  now: number
): OperationReceiptRecord {
  assertAcceptedReceiptInput(input);
  if (!isTimestamp(now)) throw operationReceiptIntegrityError("The Operation receipt timestamp is invalid.");
  return {
    version: OPERATION_RECEIPT_VERSION,
    submissionId: input.submissionId,
    fingerprint: input.fingerprint,
    operationId: input.accepted.operationId,
    operationKind: input.operationKind,
    cancellable: input.accepted.cancellable,
    acceptedHostEpoch: input.accepted.hostEpoch,
    authority: {
      sessionId: input.accepted.sessionId,
      sessionFileIdentity: input.accepted.sessionFileIdentity,
      sessionGeneration: input.accepted.sessionGeneration
    },
    startedAt: input.startedAt,
    stage: "accepted",
    createdAt: now,
    updatedAt: now
  };
}

export function acceptedFromOperationReceipt(
  record: OperationReceiptRecord,
  hostEpoch = record.acceptedHostEpoch
): OperationAccepted {
  return {
    kind: "accepted",
    operationId: record.operationId,
    cancellable: record.cancellable,
    hostEpoch,
    ...record.authority
  };
}

export function assertMatchingOperationSubmission(
  record: OperationReceiptRecord,
  fingerprint: string
): void {
  assertOperationFingerprint(fingerprint);
  if (record.fingerprint === fingerprint) return;
  throw new HostCommandError(
    "DUPLICATE_REQUEST",
    "A submission ID cannot be reused with different operation content.",
    false,
    { submissionId: record.submissionId }
  );
}

export function assertTerminalMatchesOperationReceipt(
  terminal: OperationSettled,
  record: OperationReceiptRecord
): void {
  if (
    terminal.operationId === record.operationId
    && terminal.operationKind === record.operationKind
    && terminal.startedAt === record.startedAt
  ) return;
  throw operationReceiptIntegrityError("The Operation terminal does not match its accepted receipt.");
}

export function assertConsistentOperationTerminals(records: OperationReceiptRecord[]): void {
  const terminals = new Map<string, string>();
  for (const record of records) {
    if (!record.terminal) continue;
    const serialized = JSON.stringify(record.terminal);
    const current = terminals.get(record.operationId);
    if (current !== undefined && current !== serialized) {
      throw operationReceiptIntegrityError("The durable Operation receipts contain conflicting terminal states.");
    }
    terminals.set(record.operationId, serialized);
  }
}

export function isOperationReceiptLedger(
  value: unknown,
  scopeKey: string
): value is OperationReceiptLedger {
  return isRecord(value)
    && hasOnlyKeys(value, ["version", "scopeKey", "records"])
    && value.version === OPERATION_RECEIPT_LEDGER_VERSION
    && value.scopeKey === scopeKey
    && Array.isArray(value.records)
    && value.records.length <= MAX_OPERATION_RECEIPTS
    && value.records.every(isOperationReceiptRecord)
    && new Set(value.records.map((record) => record.submissionId)).size === value.records.length;
}

export function isOperationSettledReceipt(value: unknown): value is OperationSettled {
  if (!isRecord(value)) return false;
  if (
    value.kind !== "settled"
    || !isIdentifier(value.operationId)
    || !isOperationKind(value.operationKind)
    || value.cancellable !== false
    || !isNonNegativeInteger(value.hostEpoch)
    || !isIdentifier(value.sessionId, 1_024)
    || !isFileIdentity(value.sessionFileIdentity)
    || !isNonNegativeInteger(value.sessionGeneration)
    || !isTimestamp(value.startedAt)
    || !isTimestamp(value.settledAt)
    || value.settledAt < value.startedAt
  ) return false;
  const baseKeys = [
    "kind", "operationId", "operationKind", "cancellable", "hostEpoch", "sessionId",
    "sessionFileIdentity", "sessionGeneration", "startedAt", "settledAt", "lifecycle"
  ];
  if (value.lifecycle === "completed") return hasOnlyKeys(value, baseKeys);
  if (value.lifecycle === "failed") {
    return hasOnlyKeys(value, [...baseKeys, "error"]) && isProtocolError(value.error);
  }
  return (value.lifecycle === "cancelled" || value.lifecycle === "lost")
    && hasOnlyKeys(value, [...baseKeys, "reason"])
    && isIdentifier(value.reason, 4_096);
}

export function cloneOperationReceiptLedger(
  ledger: OperationReceiptLedger
): OperationReceiptLedger {
  return { ...ledger, records: cloneOperationReceiptRecords(ledger.records) };
}

export function cloneOperationReceiptRecords(
  records: OperationReceiptRecord[]
): OperationReceiptRecord[] {
  return records.map(cloneOperationReceiptRecord);
}

export function cloneOperationReceiptRecord(
  record: OperationReceiptRecord
): OperationReceiptRecord {
  return {
    ...record,
    authority: { ...record.authority },
    ...(record.terminal === undefined ? {} : { terminal: cloneOperationTerminal(record.terminal) })
  };
}

export function cloneOperationTerminal(terminal: OperationSettled): OperationSettled {
  if (terminal.lifecycle !== "failed") return { ...terminal };
  return {
    ...terminal,
    error: {
      ...terminal.error,
      ...(terminal.error.details === undefined ? {} : { details: { ...terminal.error.details } })
    }
  };
}

export function assertOperationIdentifier(value: string, name: string): void {
  if (!isIdentifier(value)) throw new TypeError(`${name} is invalid.`);
}

export function assertOperationFingerprint(value: string): void {
  if (!isFingerprint(value)) throw new TypeError("Operation submission fingerprint is invalid.");
}

export function operationReceiptIntegrityError(message: string): HostCommandError {
  return new HostCommandError(
    "RUNTIME_POISONED",
    message,
    true,
    { operationReceiptIntegrity: true }
  );
}

export function isOperationReceiptIntegrityError(error: unknown): error is HostCommandError {
  return error instanceof HostCommandError
    && error.code === "RUNTIME_POISONED"
    && error.details?.operationReceiptIntegrity === true;
}

function isOperationReceiptRecord(value: unknown): value is OperationReceiptRecord {
  if (!isRecord(value)) return false;
  const baseKeys = [
    "version", "submissionId", "fingerprint", "operationId", "operationKind", "cancellable",
    "acceptedHostEpoch", "authority", "startedAt", "stage", "createdAt", "updatedAt"
  ];
  if (
    value.version !== OPERATION_RECEIPT_VERSION
    || !isIdentifier(value.submissionId)
    || !isFingerprint(value.fingerprint)
    || !isIdentifier(value.operationId)
    || !isOperationKind(value.operationKind)
    || typeof value.cancellable !== "boolean"
    || !isNonNegativeInteger(value.acceptedHostEpoch)
    || !isAuthority(value.authority)
    || !isTimestamp(value.startedAt)
    || !isReceiptStage(value.stage)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || value.updatedAt < value.createdAt
  ) return false;
  if (value.stage !== "settled") return value.terminal === undefined && hasOnlyKeys(value, baseKeys);
  return hasOnlyKeys(value, [...baseKeys, "terminal"])
    && isOperationSettledReceipt(value.terminal)
    && terminalMatchesValues(value.terminal, value.operationId, value.operationKind, value.startedAt);
}

function assertAcceptedReceiptInput(input: RememberOperationAcceptedInput): void {
  assertOperationIdentifier(input.submissionId, "submissionId");
  assertOperationFingerprint(input.fingerprint);
  if (!isOperationKind(input.operationKind) || !isTimestamp(input.startedAt)) {
    throw operationReceiptIntegrityError("The accepted Operation receipt metadata is invalid.");
  }
  const accepted = input.accepted;
  if (
    accepted.kind !== "accepted"
    || !isIdentifier(accepted.operationId)
    || typeof accepted.cancellable !== "boolean"
    || !isNonNegativeInteger(accepted.hostEpoch)
    || !isIdentifier(accepted.sessionId, 1_024)
    || !isFileIdentity(accepted.sessionFileIdentity)
    || !isNonNegativeInteger(accepted.sessionGeneration)
  ) throw operationReceiptIntegrityError("The accepted Operation receipt is invalid.");
}

function assertReceiptScope(scope: OperationReceiptScope): void {
  assertOperationIdentifier(scope.workspaceId, "workspaceId");
  assertOperationIdentifier(scope.taskId, "taskId");
  if (!isNonNegativeInteger(scope.taskGeneration)) {
    throw new TypeError("taskGeneration must be a non-negative integer.");
  }
}

function isProtocolError(value: unknown): value is ProtocolError {
  if (!isRecord(value)) return false;
  const allowed = ["code", "message", "recoverable", "retryAfterMs", "details"];
  return hasAllowedKeys(value, allowed)
    && isIdentifier(value.code, 128)
    && isIdentifier(value.message, 4_096)
    && typeof value.recoverable === "boolean"
    && (value.retryAfterMs === undefined || isNonNegativeNumber(value.retryAfterMs))
    && (value.details === undefined || isProtocolErrorDetails(value.details));
}

function isProtocolErrorDetails(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).length <= 32
    && Object.values(value).every((detail) => (
      typeof detail === "boolean"
      || (typeof detail === "number" && Number.isFinite(detail))
      || (typeof detail === "string" && detail.length <= 4_096)
    ));
}

function terminalMatchesValues(
  terminal: OperationSettled,
  operationId: unknown,
  operationKind: unknown,
  startedAt: unknown
): boolean {
  return terminal.operationId === operationId
    && terminal.operationKind === operationKind
    && terminal.startedAt === startedAt;
}

function isAuthority(value: unknown): value is OperationReceiptAuthority {
  return isRecord(value)
    && hasOnlyKeys(value, ["sessionId", "sessionFileIdentity", "sessionGeneration"])
    && isIdentifier(value.sessionId, 1_024)
    && isFileIdentity(value.sessionFileIdentity)
    && isNonNegativeInteger(value.sessionGeneration);
}

function isOperationKind(value: unknown): value is OperationKind {
  return value === "prompt" || value === "command" || value === "compaction" || value === "session-import";
}

function isReceiptStage(value: unknown): value is OperationReceiptStage {
  return value === "accepted" || value === "running" || value === "settled";
}

function isIdentifier(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}

function isFileIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
