import type { RuntimeIdentity } from "@pi67/domain";
import type { AgentEvent, OperationSubmissionResult } from "@pi67/protocol";
import { assertCurrentOperationAuthority } from "./operation-authority.js";
import { acceptedOperation } from "./operation-registry-authority.js";
import type { OperationResultLedger } from "./operation-result-ledger.js";
import type { SubmissionAuthority } from "./operation-submission-ledger.js";
import type { ActiveOperation } from "./operation-terminal-coordinator.js";
import { toProtocolError } from "./protocol-error.js";

interface OperationExecutionRunnerOptions {
  emit(event: AgentEvent): void;
  finishCompleted(operationId: string): Promise<void>;
  finishFailed(operationId: string, error: ReturnType<typeof toProtocolError>): Promise<void>;
  getIdentity(): RuntimeIdentity;
  hostEpoch: number;
  isActive(operationId: string): boolean;
  results: OperationResultLedger;
  withDurability<T>(operation: () => Promise<T>): Promise<T>;
}

export class OperationExecutionRunner {
  constructor(private readonly options: OperationExecutionRunnerOptions) {}

  async start(
    operation: ActiveOperation,
    submissionId: string,
    fingerprint: string,
    execute: () => Promise<void>
  ): Promise<void> {
    await this.options.withDurability(() => this.options.results.markRunning(submissionId, fingerprint));
    if (!this.options.isActive(operation.view.operationId)) return;
    this.options.emit({ type: "operation.started", payload: { operation: operation.view } });
    try {
      await execute();
    } catch (error) {
      await this.options.finishFailed(operation.view.operationId, toProtocolError(error));
      return;
    }
    await this.options.finishCompleted(operation.view.operationId);
  }

  async queue(
    operation: ActiveOperation,
    submissionId: string,
    fingerprint: string,
    authority: SubmissionAuthority,
    execute: () => Promise<void>
  ): Promise<OperationSubmissionResult> {
    const remembered = await this.options.withDurability(() => this.options.results.rememberAccepted({
      submissionId,
      fingerprint,
      operationKind: operation.view.kind,
      startedAt: operation.view.startedAt,
      accepted: acceptedOperation(operation.view, this.options.hostEpoch),
      authority
    }));
    if (!remembered.created) return remembered.result;
    await this.options.withDurability(() => this.options.results.markRunning(submissionId, fingerprint));
    if (this.options.isActive(operation.view.operationId) && operation.terminalLifecycle === undefined) {
      await execute();
      assertCurrentOperationAuthority(this.options.getIdentity(), authority);
    }
    return await this.options.results.get(submissionId, fingerprint) ?? remembered.result;
  }
}
