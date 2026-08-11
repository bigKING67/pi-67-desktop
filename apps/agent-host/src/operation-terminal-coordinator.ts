import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type { AgentEvent, OperationSettled, OperationSubmissionResult, ProtocolError } from "@pi67/protocol";
import type { OperationActivityController } from "./operation-activity-controller.js";
import type { OperationHeartbeatController } from "./operation-heartbeat-controller.js";
import type { OperationResultLedger } from "./operation-result-ledger.js";
import type { OperationTerminalDetails } from "./operation-terminal-ledger.js";
import type { OperationToolExecutionController } from "./operation-tool-execution-controller.js";

export interface ActiveOperation {
  view: OperationView;
  submissionId: string;
  abort?: () => Promise<void>;
  beforeTerminal?: () => void;
  terminalPrepared?: boolean;
  terminalLifecycle?: "completed" | "failed" | "cancelled" | "lost";
  terminalPromise?: Promise<boolean>;
  pendingQueues: Set<Promise<OperationSubmissionResult>>;
  settled?: { kind: "completed" } | { kind: "failed"; error: ProtocolError };
}

interface OperationTerminalCoordinatorOptions {
  activity: OperationActivityController;
  emit(event: AgentEvent): void;
  getIdentity(): RuntimeIdentity;
  heartbeat: OperationHeartbeatController;
  results: OperationResultLedger;
  toolExecutions: OperationToolExecutionController;
  withDurability<T>(operation: () => Promise<T>): Promise<T>;
}

export class OperationTerminalCoordinator {
  constructor(private readonly options: OperationTerminalCoordinatorOptions) {}

  lost(operation: ActiveOperation, reason: string, lostAt: number): Promise<boolean> {
    return this.finalize(operation, { lifecycle: "lost", settledAt: lostAt, reason });
  }

  finalize(operation: ActiveOperation, details: OperationTerminalDetails): Promise<boolean> {
    if (operation.terminalPromise) return operation.terminalPromise;
    if (operation.terminalLifecycle) return Promise.resolve(false);
    operation.terminalLifecycle = details.lifecycle;
    operation.terminalPromise = this.persist(operation, details);
    return operation.terminalPromise;
  }

  prepare(operation: ActiveOperation): void {
    if (operation.terminalPrepared) return;
    operation.terminalPrepared = true;
    operation.beforeTerminal?.();
  }

  private async persist(
    operation: ActiveOperation,
    details: OperationTerminalDetails
  ): Promise<boolean> {
    await Promise.allSettled(operation.pendingQueues);
    this.options.heartbeat.stop(operation.view.operationId);
    this.prepare(operation);
    this.options.toolExecutions.settle(operation, details.lifecycle, details.settledAt);
    const terminal = await this.options.withDurability(() => this.options.results.settle(
      operation.view,
      this.options.getIdentity(),
      details
    ));
    operation.terminalLifecycle = terminal.lifecycle;
    this.options.emit(eventFromTerminal(terminal));
    this.options.activity.reset();
    return true;
  }
}

function eventFromTerminal(terminal: OperationSettled): AgentEvent {
  const operationId = terminal.operationId;
  if (terminal.lifecycle === "completed") {
    return { type: "operation.completed", payload: { operationId, completedAt: terminal.settledAt } };
  }
  if (terminal.lifecycle === "failed") {
    return { type: "operation.failed", payload: { operationId, failedAt: terminal.settledAt, error: terminal.error } };
  }
  if (terminal.lifecycle === "cancelled") {
    return { type: "operation.cancelled", payload: { operationId, cancelledAt: terminal.settledAt, reason: terminal.reason } };
  }
  return { type: "operation.lost", payload: { operationId, lostAt: terminal.settledAt, reason: terminal.reason } };
}
