import type { OperationSettled } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  MAX_OPERATION_RECEIPTS,
  assertMatchingOperationSubmission,
  assertOperationFingerprint,
  assertOperationIdentifier,
  assertTerminalMatchesOperationReceipt,
  cloneOperationReceiptLedger,
  cloneOperationReceiptRecord,
  cloneOperationReceiptRecords,
  cloneOperationTerminal,
  createAcceptedOperationReceipt,
  emptyOperationReceiptLedger,
  isOperationSettledReceipt,
  operationReceiptIntegrityError,
  operationReceiptScopeKey,
  type OperationReceiptLedger,
  type OperationReceiptRecord,
  type OperationReceiptScope,
  type RememberOperationAcceptedInput,
  type RememberOperationAcceptedResult
} from "./operation-receipt-contract.js";
import {
  operationReceiptLedgerPath,
  withStoredOperationReceiptLedger
} from "./operation-receipt-storage.js";

export type {
  OperationReceiptRecord,
  OperationReceiptScope,
  RememberOperationAcceptedInput,
  RememberOperationAcceptedResult
} from "./operation-receipt-contract.js";
export { acceptedFromOperationReceipt } from "./operation-receipt-contract.js";

export interface OperationReceiptStoreOptions {
  storageRoot?: string;
  maxReceipts?: number;
  now?: () => number;
}

/** Task-scoped state machine for cross-Host side-effect replay protection. */
export class OperationReceiptStore {
  private readonly scopeKey: string;
  private readonly ledgerPath: string | undefined;
  private readonly maxReceipts: number;
  private readonly now: () => number;
  private memoryLedger: OperationReceiptLedger;

  constructor(scope: OperationReceiptScope, options: OperationReceiptStoreOptions = {}) {
    this.scopeKey = operationReceiptScopeKey(scope);
    this.ledgerPath = operationReceiptLedgerPath(options.storageRoot, this.scopeKey);
    this.maxReceipts = positiveInteger(options.maxReceipts, MAX_OPERATION_RECEIPTS, "maxReceipts");
    this.now = options.now ?? Date.now;
    this.memoryLedger = emptyOperationReceiptLedger(this.scopeKey);
  }

  async records(): Promise<OperationReceiptRecord[]> {
    return this.withLedger((ledger) => cloneOperationReceiptRecords(ledger.records), false);
  }

  async rememberAccepted(
    input: RememberOperationAcceptedInput
  ): Promise<RememberOperationAcceptedResult> {
    return this.withLedger((ledger) => {
      const existing = ledger.records.find((record) => record.submissionId === input.submissionId);
      if (existing) {
        assertMatchingOperationSubmission(existing, input.fingerprint);
        return { created: false, record: cloneOperationReceiptRecord(existing) };
      }
      const record = createAcceptedOperationReceipt(input, this.now());
      ledger.records.push(record);
      pruneSettledReceipts(ledger.records, this.maxReceipts);
      if (ledger.records.length > this.maxReceipts) {
        throw new HostCommandError(
          "RESOURCE_LIMIT_EXCEEDED",
          "The durable Operation receipt limit is full of unsettled submissions.",
          true,
          { maxReceipts: this.maxReceipts }
        );
      }
      return { created: true, record: cloneOperationReceiptRecord(record) };
    }, true);
  }

  async markRunning(submissionId: string, fingerprint: string): Promise<OperationReceiptRecord> {
    assertOperationIdentifier(submissionId, "submissionId");
    assertOperationFingerprint(fingerprint);
    return this.withLedger((ledger) => {
      const record = requireRecord(ledger.records, submissionId);
      assertMatchingOperationSubmission(record, fingerprint);
      if (record.stage !== "settled") {
        record.stage = "running";
        record.updatedAt = this.now();
      }
      return cloneOperationReceiptRecord(record);
    }, true);
  }

  async settleOperation(
    operationId: string,
    terminal: OperationSettled
  ): Promise<OperationReceiptRecord[]> {
    assertOperationIdentifier(operationId, "operationId");
    if (!isOperationSettledReceipt(terminal) || terminal.operationId !== operationId) {
      throw operationReceiptIntegrityError("The Operation terminal receipt is invalid.");
    }
    return this.withLedger((ledger) => {
      const matches = ledger.records.filter((record) => record.operationId === operationId);
      if (matches.length === 0) {
        throw operationReceiptIntegrityError("The Operation receipt is missing its accepted record.");
      }
      const canonical = matches.find((record) => record.terminal !== undefined)?.terminal ?? terminal;
      for (const record of matches) {
        assertTerminalMatchesOperationReceipt(canonical, record);
        record.stage = "settled";
        record.terminal = cloneOperationTerminal(canonical);
        record.updatedAt = this.now();
      }
      return cloneOperationReceiptRecords(matches);
    }, true);
  }

  private async withLedger<T>(
    operation: (ledger: OperationReceiptLedger) => T,
    write: boolean
  ): Promise<T> {
    if (this.ledgerPath) {
      return withStoredOperationReceiptLedger(
        this.ledgerPath,
        this.scopeKey,
        write,
        operation
      );
    }
    const draft = cloneOperationReceiptLedger(this.memoryLedger);
    const result = operation(draft);
    if (write) this.memoryLedger = draft;
    return result;
  }
}

function pruneSettledReceipts(records: OperationReceiptRecord[], maximum: number): void {
  while (records.length > maximum) {
    const settledIndex = records.findIndex((record) => record.stage === "settled");
    if (settledIndex < 0) return;
    records.splice(settledIndex, 1);
  }
}

function requireRecord(
  records: OperationReceiptRecord[],
  submissionId: string
): OperationReceiptRecord {
  const record = records.find((candidate) => candidate.submissionId === submissionId);
  if (record) return record;
  throw operationReceiptIntegrityError("The durable Operation receipt is missing.");
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_OPERATION_RECEIPTS) {
    throw new RangeError(`${name} must be an integer between 1 and ${MAX_OPERATION_RECEIPTS}.`);
  }
  return resolved;
}
