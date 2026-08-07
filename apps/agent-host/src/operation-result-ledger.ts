import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type {
  OperationAccepted,
  OperationSettled,
  OperationSubmissionResult
} from "@pi67/protocol";
import {
  acceptedFromOperationReceipt,
  type OperationReceiptRecord,
  type OperationReceiptStore
} from "./operation-receipt-store.js";
import { OperationTerminalLedger, type OperationTerminalDetails } from "./operation-terminal-ledger.js";
import {
  assertCurrentSubmissionAuthority,
  OperationSubmissionLedger,
  type SubmissionAuthority
} from "./operation-submission-ledger.js";
import { operationReceiptIntegrityError } from "./operation-receipt-contract.js";

const HOST_CRASH_REASON = "The previous Pi runtime service exited before the Operation terminal was confirmed; the side-effecting submission was not replayed.";

export interface RememberOperationResultOptions {
  submissionId: string;
  fingerprint: string;
  operationKind: OperationView["kind"];
  startedAt: number;
  accepted: OperationAccepted;
  authority: SubmissionAuthority;
}

/** Combines bounded in-memory replay state with the durable cross-Host receipt ledger. */
export class OperationResultLedger {
  private readonly submissions: OperationSubmissionLedger;
  private readonly terminals: OperationTerminalLedger;
  private reconciliation: Promise<void> | undefined;
  private reconciled = false;

  constructor(
    private readonly hostEpoch: number,
    maxSubmissions: number,
    private readonly getIdentity: () => RuntimeIdentity,
    private readonly receiptStore: OperationReceiptStore | undefined,
    private readonly now: () => number
  ) {
    this.submissions = new OperationSubmissionLedger(maxSubmissions, getIdentity);
    this.terminals = new OperationTerminalLedger(hostEpoch, maxSubmissions);
  }

  get(submissionId: string, fingerprint: string): OperationSubmissionResult | Promise<OperationSubmissionResult> | undefined {
    return this.submissions.get(submissionId, fingerprint);
  }

  latestTerminal(): OperationSettled | undefined {
    return this.terminals.latest();
  }

  rememberPending(
    submissionId: string,
    fingerprint: string,
    result: Promise<OperationSubmissionResult>,
    authority: SubmissionAuthority
  ): void {
    this.submissions.rememberPending(submissionId, fingerprint, result, authority);
  }

  deletePending(submissionId: string): void {
    this.submissions.deletePending(submissionId);
  }

  reconcile(): Promise<void> {
    if (this.reconciled || !this.receiptStore) return Promise.resolve();
    if (this.reconciliation) return this.reconciliation;
    this.reconciliation = this.reconcileStoredReceipts().then(() => {
      this.reconciled = true;
    }).finally(() => {
      this.reconciliation = undefined;
    });
    return this.reconciliation;
  }

  async rememberAccepted(
    options: RememberOperationResultOptions
  ): Promise<{ created: boolean; result: OperationSubmissionResult }> {
    if (!this.receiptStore) {
      return {
        created: true,
        result: this.submissions.remember(
          options.submissionId,
          options.fingerprint,
          options.accepted,
          options.authority
        )
      };
    }
    const remembered = await this.receiptStore.rememberAccepted(options);
    if (remembered.created) {
      this.hydrate(remembered.record);
      return { created: true, result: this.requireSubmission(options.submissionId, options.fingerprint) };
    }
    assertCurrentSubmissionAuthority(this.getIdentity(), authorityForReceipt(remembered.record));
    const recovered = remembered.record.stage === "settled"
      ? [remembered.record]
      : await this.receiptStore.settleOperation(
          remembered.record.operationId,
          lostTerminal(remembered.record, this.hostEpoch, this.now())
        );
    recovered.forEach((record) => this.hydrate(record));
    return { created: false, result: this.requireSubmission(options.submissionId, options.fingerprint) };
  }

  async markRunning(submissionId: string, fingerprint: string): Promise<void> {
    await this.receiptStore?.markRunning(submissionId, fingerprint);
  }

  async settle(
    operation: OperationView,
    current: RuntimeIdentity,
    details: OperationTerminalDetails
  ): Promise<OperationSettled> {
    const candidate = this.terminals.create(operation, current, details);
    if (!this.receiptStore) {
      const terminal = this.terminals.restore(candidate);
      this.submissions.updateTerminal(terminal);
      return terminal;
    }
    const records = await this.receiptStore.settleOperation(operation.operationId, candidate);
    records.forEach((record) => this.hydrate(record));
    const terminal = records.find((record) => record.terminal !== undefined)?.terminal;
    if (!terminal) throw operationReceiptIntegrityError("The settled Operation receipt has no terminal state.");
    return this.terminals.restore(terminal);
  }

  private async reconcileStoredReceipts(): Promise<void> {
    const records = await this.receiptStore!.records();
    const current = this.getIdentity();
    const matching = records.filter((record) => receiptMatchesIdentity(record, current));
    const groups = groupByOperation(matching);
    for (const group of groups.values()) {
      const settled = group.filter((record) => record.stage === "settled");
      if (settled.length > 0 && settled.length !== group.length) {
        throw operationReceiptIntegrityError("The durable Operation receipts contain a partial terminal commit.");
      }
      const recovered = settled.length > 0
        ? group
        : await this.receiptStore!.settleOperation(
            group[0]!.operationId,
            lostTerminal(group[0]!, this.hostEpoch, this.now())
          );
      recovered
        .filter((record) => receiptMatchesIdentity(record, current))
        .forEach((record) => this.hydrate(record));
    }
  }

  private hydrate(record: OperationReceiptRecord): void {
    const result = record.terminal
      ? this.terminals.restore(record.terminal)
      : acceptedFromOperationReceipt(record, this.hostEpoch);
    this.submissions.remember(
      record.submissionId,
      record.fingerprint,
      result,
      authorityForReceipt(record)
    );
  }

  private requireSubmission(submissionId: string, fingerprint: string): OperationSubmissionResult {
    const result = this.submissions.get(submissionId, fingerprint);
    if (!result || result instanceof Promise) {
      throw operationReceiptIntegrityError("The durable Operation receipt was not projected into replay state.");
    }
    return result;
  }
}

function authorityForReceipt(record: OperationReceiptRecord): SubmissionAuthority {
  const terminal = record.terminal;
  return terminal
    ? {
        sessionId: terminal.sessionId,
        sessionFileIdentity: terminal.sessionFileIdentity,
        sessionGeneration: terminal.sessionGeneration
      }
    : { ...record.authority };
}

function receiptMatchesIdentity(record: OperationReceiptRecord, current: RuntimeIdentity): boolean {
  const authority = authorityForReceipt(record);
  return current.sessionId === authority.sessionId
    && current.sessionFileIdentity === authority.sessionFileIdentity
    && current.sessionGeneration === authority.sessionGeneration;
}

function groupByOperation(records: OperationReceiptRecord[]): Map<string, OperationReceiptRecord[]> {
  const groups = new Map<string, OperationReceiptRecord[]>();
  for (const record of records) {
    const group = groups.get(record.operationId) ?? [];
    group.push(record);
    groups.set(record.operationId, group);
  }
  return groups;
}

function lostTerminal(
  record: OperationReceiptRecord,
  hostEpoch: number,
  lostAt: number
): OperationSettled {
  return {
    kind: "settled",
    operationId: record.operationId,
    operationKind: record.operationKind,
    cancellable: false,
    hostEpoch,
    ...record.authority,
    startedAt: record.startedAt,
    settledAt: lostAt,
    lifecycle: "lost",
    reason: HOST_CRASH_REASON
  };
}
