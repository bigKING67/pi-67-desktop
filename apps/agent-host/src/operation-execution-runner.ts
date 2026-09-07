import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type { AgentEvent, OperationSubmissionResult } from "@pi67/protocol";
import { assertCurrentOperationAuthority } from "./operation-authority.js";
import { acceptedOperation } from "./operation-registry-authority.js";
import type { OperationResultLedger } from "./operation-result-ledger.js";
import type { SubmissionAuthority } from "./operation-submission-ledger.js";
import type { ActiveOperation } from "./operation-terminal-coordinator.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";

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

export interface OperationExecutionContext {
  operation: OperationView;
  hostEpoch: number;
  signal: AbortSignal;
}

export class OperationExecutionRunner {
  constructor(private readonly options: OperationExecutionRunnerOptions) {}

  schedule(
    operation: ActiveOperation,
    submissionId: string,
    fingerprint: string,
    execute: (context: OperationExecutionContext) => Promise<void>
  ): void {
    setTimeout(() => {
      if (operation.abortController.signal.aborted) return;
      operation.executionPromise = this.start(
        operation,
        submissionId,
        fingerprint,
        execute,
        {
          operation: operation.view,
          hostEpoch: this.options.hostEpoch,
          signal: operation.abortController.signal
        }
      ).catch(() => undefined);
    }, 0);
  }

  async stop(operation: ActiveOperation): Promise<void> {
    operation.queueAbortController?.abort();
    await operation.abort?.();
    operation.abortController.abort();
    await operation.executionPromise;
  }

  async start(
    operation: ActiveOperation,
    submissionId: string,
    fingerprint: string,
    execute: (context: OperationExecutionContext) => Promise<void>,
    context: OperationExecutionContext
  ): Promise<void> {
    await this.options.withDurability(() => this.options.results.markRunning(submissionId, fingerprint));
    if (!this.options.isActive(operation.view.operationId)) return;
    this.options.emit({ type: "operation.started", payload: { operation: operation.view } });
    try {
      await execute(context);
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
    execute: (signal: AbortSignal) => Promise<void>
  ): Promise<OperationSubmissionResult> {
    const signal = (operation.queueAbortController ??= new AbortController()).signal;
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
      await deliverQueuedPrompt(execute, signal);
      assertCurrentOperationAuthority(this.options.getIdentity(), authority);
    }
    return await this.options.results.get(submissionId, fingerprint) ?? remembered.result;
  }
}

function deliverQueuedPrompt(execute: (signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new HostCommandError("STALE_OPERATION", "Queued prompt delivery was cancelled."));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    const execution = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return execute(signal);
    });
    void execution.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
