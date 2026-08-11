import type {
  OperationActivity,
  OperationKind,
  OperationView,
  RuntimeIdentity,
  RuntimeOperationActivity, ToolExecutionView
} from "@pi67/domain";
import {
  type AgentHostRuntimePoisonedMessage,
  type AgentEvent,
  type OperationAccepted,
  type OperationSettled,
  type OperationSubmissionResult,
  type ProtocolError
} from "@pi67/protocol";
import { AbortWatchdogExpiredError, withAbortWatchdog } from "./operation-abort-watchdog.js";
import { OperationActivityController } from "./operation-activity-controller.js";
import {
  OperationHeartbeatController,
  type OperationHeartbeatControllerOptions,
  type OperationHeartbeatDiagnostics
} from "./operation-heartbeat-controller.js";
import { assertOperationAuthority } from "./operation-authority.js";
import { OperationExecutionRunner, type OperationExecutionContext } from "./operation-execution-runner.js";
import { isOperationReceiptIntegrityError } from "./operation-receipt-contract.js";
import type { OperationReceiptStore } from "./operation-receipt-store.js";
import { acceptedOperation, createOperationView, requireOperationSessionIdentity } from "./operation-registry-authority.js";
import { OperationResultLedger } from "./operation-result-ledger.js";
import { type ActiveOperation, OperationTerminalCoordinator } from "./operation-terminal-coordinator.js";
import { OperationToolExecutionController } from "./operation-tool-execution-controller.js";
import { authorityFromIdentity } from "./operation-submission-ledger.js";
import { HostCommandError } from "./protocol-error.js";

export type OperationShutdownResult = "none" | "cancelled" | "lost";

export interface AcceptOperationOptions {
  submissionId: string;
  fingerprint: string;
  kind: OperationKind;
  execute: (context: OperationExecutionContext) => Promise<void>;
  abort?: () => Promise<void>;
  beforeTerminal?: () => void;
}

export interface OperationRegistryOptions extends OperationHeartbeatControllerOptions {
  maxSubmissions?: number;
  abortWatchdogMs?: number;
  receiptStore?: OperationReceiptStore;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
}

export interface OperationRegistryDiagnostics {
  accepting: boolean;
  active: boolean;
  terminating: boolean;
  poisoned: boolean;
  heartbeat: OperationHeartbeatDiagnostics;
}
const DEFAULT_ABORT_WATCHDOG_MS = 10_000;

export class OperationRegistry {
  private active: ActiveOperation | undefined;
  private terminating: ActiveOperation | undefined;
  private readonly results: OperationResultLedger;
  private readonly activity: OperationActivityController;
  private readonly toolExecutions: OperationToolExecutionController;
  private readonly heartbeat: OperationHeartbeatController;
  private readonly terminals: OperationTerminalCoordinator;
  private readonly executions: OperationExecutionRunner;
  private readonly maxSubmissions: number;
  private readonly abortWatchdogMs: number;
  private readonly now: () => number;
  private readonly onRuntimePoisoned: ((message: AgentHostRuntimePoisonedMessage) => void) | undefined;
  private receiptFailure: HostCommandError | undefined;
  private accepting = false;
  private poisoned = false;

  constructor(
    private readonly hostEpoch: number,
    private readonly getIdentity: () => RuntimeIdentity,
    private readonly emit: (event: AgentEvent) => void,
    options: OperationRegistryOptions = {}
  ) {
    this.maxSubmissions = positiveInteger(options.maxSubmissions, 512, "maxSubmissions");
    this.activity = new OperationActivityController(emit);
    this.toolExecutions = new OperationToolExecutionController(emit);
    this.abortWatchdogMs = positiveInteger(options.abortWatchdogMs, DEFAULT_ABORT_WATCHDOG_MS, "abortWatchdogMs");
    this.now = options.now ?? Date.now;
    this.results = new OperationResultLedger(
      hostEpoch,
      this.maxSubmissions,
      getIdentity,
      options.receiptStore,
      this.now
    );
    this.heartbeat = new OperationHeartbeatController(emit, { ...options, now: this.now });
    this.terminals = new OperationTerminalCoordinator({
      activity: this.activity,
      emit,
      getIdentity,
      heartbeat: this.heartbeat,
      results: this.results,
      toolExecutions: this.toolExecutions,
      withDurability: (operation) => this.withDurability(operation)
    });
    this.executions = new OperationExecutionRunner({
      emit,
      finishCompleted: (operationId) => this.finishCompleted(operationId),
      finishFailed: (operationId, error) => this.finishFailed(operationId, error),
      getIdentity,
      hostEpoch,
      isActive: (operationId) => this.active?.view.operationId === operationId,
      results: this.results,
      withDurability: (operation) => this.withDurability(operation)
    });
    this.onRuntimePoisoned = options.onRuntimePoisoned;
  }

  hasActive(): boolean { return this.poisoned || this.accepting || this.active !== undefined || this.terminating !== undefined; }
  isPoisoned(): boolean { return this.poisoned; }
  diagnostics(): OperationRegistryDiagnostics {
    return {
      accepting: this.accepting,
      active: this.active !== undefined,
      terminating: this.terminating !== undefined,
      poisoned: this.poisoned,
      heartbeat: this.heartbeat.diagnostics()
    };
  }
  canAcceptQueue(): boolean {
    return this.active !== undefined
      && this.active.terminalLifecycle === undefined
      && acceptsPiQueue(this.active.view.kind);
  }
  activeAccepted(): OperationAccepted | undefined {
    const operation = this.active ?? this.terminating;
    return operation ? acceptedOperation(operation.view, this.hostEpoch) : undefined;
  }
  activeView(): OperationView | undefined { return (this.active ?? this.terminating)?.view; }
  updateActivity(activity: RuntimeOperationActivity): boolean {
    this.heartbeat.touch(this.active?.view.operationId);
    return this.activity.updateBase(this.active, activity);
  }
  updateToolExecution(execution: ToolExecutionView): boolean {
    this.heartbeat.touch(this.active?.view.operationId);
    return this.toolExecutions.update(this.active, execution);
  }
  observeEventActivity(event: AgentEvent): boolean {
    const operation = this.active ?? this.terminating;
    return this.heartbeat.observeEvent(event, operation?.view.operationId);
  }
  beginInteractiveWait(
    activity: Extract<OperationActivity, { kind: "approval" | "extension-input" }>
  ): boolean {
    return this.activity.beginInteractive(this.active, activity)
      && this.heartbeat.touch(this.active?.view.operationId);
  }
  completeInteractiveWait(requestId: string): boolean {
    return this.activity.completeInteractive(this.active, requestId)
      && this.heartbeat.touch(this.active?.view.operationId);
  }
  latestTerminal(): OperationSettled | undefined { return this.results.latestTerminal(); }
  async reconcile(): Promise<void> {
    this.assertHealthy();
    await this.withDurability(() => this.results.reconcile());
  }

  submissionFor(submissionId: string, fingerprint: string):
    OperationSubmissionResult | Promise<OperationSubmissionResult> | undefined {
    this.assertHealthy();
    return this.results.get(submissionId, fingerprint);
  }

  async accept(options: AcceptOperationOptions): Promise<OperationSubmissionResult> {
    if (this.accepting) throw new HostCommandError("BUSY", "Another operation is being accepted.");
    this.accepting = true;
    try {
      await this.reconcile();
      const existing = this.submissionFor(options.submissionId, options.fingerprint);
      if (existing) return await existing;
      if (this.active) throw new HostCommandError("BUSY", "Another operation is already active.");
      const identity = requireOperationSessionIdentity(this.getIdentity());
      const startedAt = this.now();
      const view = createOperationView(identity, options.kind, options.abort !== undefined, startedAt);
      const authority = authorityFromIdentity(identity);
      const remembered = await this.withDurability(() => this.results.rememberAccepted({
        submissionId: options.submissionId,
        fingerprint: options.fingerprint,
        operationKind: options.kind,
        startedAt,
        accepted: acceptedOperation(view, this.hostEpoch),
        authority
      }));
      if (!remembered.created) return remembered.result;
      this.activity.reset();
      this.toolExecutions.reset();
      const operation: ActiveOperation = {
        view,
        submissionId: options.submissionId,
        pendingQueues: new Set(),
        ...(options.abort === undefined ? {} : { abort: options.abort }),
        ...(options.beforeTerminal === undefined ? {} : { beforeTerminal: options.beforeTerminal })
      };
      this.active = operation;
      this.heartbeat.start(view.operationId, startedAt);
      // Start on the next task so the accepted response is posted before operation events.
      setTimeout(() => void this.executions.start(
        operation,
        options.submissionId,
        options.fingerprint,
        options.execute,
        { operation: operation.view, hostEpoch: this.hostEpoch }
      ).catch(() => undefined), 0);
      return remembered.result;
    } finally {
      this.accepting = false;
    }
  }

  async queueForActive(
    submissionId: string,
    fingerprint: string,
    execute: () => Promise<void>
  ): Promise<OperationSubmissionResult> {
    const existing = this.submissionFor(submissionId, fingerprint);
    if (existing) return await existing;
    if (!this.active || !acceptsPiQueue(this.active.view.kind)) {
      throw new HostCommandError("OPERATION_NOT_FOUND", "There is no active turn operation to receive a queued prompt.");
    }
    const authority = authorityFromIdentity(
      requireOperationSessionIdentity(this.getIdentity())
    );
    assertOperationAuthority(authority, this.active.view);
    const operation = this.active;
    const pending = this.executions.queue(
      operation,
      submissionId,
      fingerprint,
      authority,
      execute
    );
    operation.pendingQueues.add(pending);
    this.results.rememberPending(submissionId, fingerprint, pending, authority);
    return pending.finally(() => {
      operation.pendingQueues.delete(pending);
      this.results.deletePending(submissionId);
    });
  }

  async abort(operationId: string | undefined): Promise<{ aborted: boolean; operationId?: string }> {
    this.assertHealthy();
    const active = this.active;
    if (!active || !active.abort || (operationId !== undefined && operationId !== active.view.operationId)) {
      return { aborted: false, ...(operationId === undefined ? {} : { operationId }) };
    }
    if (active.terminalLifecycle) {
      await active.terminalPromise;
      return { aborted: false, operationId: active.view.operationId };
    }
    // Claim the terminal state before awaiting Pi so a resolving prompt cannot win the race.
    this.active = undefined;
    this.terminating = active;
    try {
      await withAbortWatchdog(active.abort(), this.abortWatchdogMs);
      const cancelledAt = this.now();
      await this.terminals.finalize(
        active,
        { lifecycle: "cancelled", settledAt: cancelledAt, reason: "Cancelled by the user." }
      );
    } catch (error) {
      if (error instanceof AbortWatchdogExpiredError) {
        await this.poisonAfterAbortTimeout(active);
        throw new HostCommandError(
          "RUNTIME_POISONED",
          "Pi did not acknowledge abort before the safety watchdog expired.",
          true,
          { abortTimeoutMs: this.abortWatchdogMs }
        );
      }
      if (isOperationReceiptIntegrityError(error)) throw error;
      await this.restoreAfterAbortFailure(active);
      throw error;
    } finally {
      if (this.terminating?.view.operationId === active.view.operationId) this.terminating = undefined;
    }
    return { aborted: true, operationId: active.view.operationId };
  }

  async shutdown(
    reason = "Cancelled because the application is shutting down.",
    timeoutMs = this.abortWatchdogMs
  ): Promise<OperationShutdownResult> {
    const wasAlreadyTerminating = this.active === undefined && this.terminating !== undefined;
    const operation = this.active ?? this.terminating;
    if (!operation) return "none";

    this.active = undefined;
    if (this.terminating?.view.operationId !== operation.view.operationId) this.terminating = operation;
    if (operation.terminalLifecycle) {
      await operation.terminalPromise;
      if (this.terminating?.view.operationId === operation.view.operationId) this.terminating = undefined;
      return shutdownResultFor(operation.terminalLifecycle);
    }
    if (wasAlreadyTerminating || !operation.abort) {
      await this.terminals.lost(operation, reason, this.now());
      if (this.terminating?.view.operationId === operation.view.operationId) this.terminating = undefined;
      return "lost";
    }

    try {
      await withAbortWatchdog(operation.abort(), positiveInteger(timeoutMs, timeoutMs, "timeoutMs"));
      const cancelledAt = this.now();
      await this.terminals.finalize(
        operation,
        { lifecycle: "cancelled", settledAt: cancelledAt, reason }
      );
    } catch {
      await this.terminals.lost(operation, reason, this.now());
    } finally {
      if (this.terminating?.view.operationId === operation.view.operationId) this.terminating = undefined;
    }
    return operation.terminalLifecycle === "cancelled" ? "cancelled" : "lost";
  }

  async loseActive(reason: string): Promise<void> {
    if (this.poisoned) return;
    const active = this.active;
    const terminating = this.terminating;
    if (!active && !terminating) return;
    this.active = undefined;
    this.terminating = undefined;
    this.activity.reset();
    const lost = active ?? terminating!;
    await this.terminals.lost(lost, reason, this.now());
  }

  async poisonSessionImportProjection(): Promise<boolean> {
    if (this.poisoned) return false;
    const active = this.active;
    if (active?.view.kind !== "session-import") return false;
    this.active = undefined;
    this.poisoned = true;
    const reason = "The imported Pi Session became authoritative, but its projection could not be captured; Pi runtime service recovery is required.";
    await this.terminals.lost(active, reason, this.now());
    this.onRuntimePoisoned?.({
      type: "agent-host-runtime-poisoned",
      code: "SESSION_IMPORT_PROJECTION_FAILED",
      operationId: active.view.operationId
    });
    return true;
  }

  private async finishCompleted(operationId: string): Promise<void> {
    if (this.terminating?.view.operationId === operationId) {
      this.terminating.settled = { kind: "completed" };
      this.terminals.prepare(this.terminating);
      return;
    }
    if (this.active?.view.operationId !== operationId) return;
    const completedAt = this.now();
    await this.terminals.finalize(
      this.active,
      { lifecycle: "completed", settledAt: completedAt }
    );
    this.active = undefined;
  }

  private async finishFailed(operationId: string, error: ProtocolError): Promise<void> {
    if (this.terminating?.view.operationId === operationId) {
      this.terminating.settled = { kind: "failed", error };
      this.terminals.prepare(this.terminating);
      return;
    }
    if (this.active?.view.operationId !== operationId) return;
    const failedAt = this.now();
    await this.terminals.finalize(
      this.active,
      { lifecycle: "failed", settledAt: failedAt, error }
    );
    this.active = undefined;
  }

  private async restoreAfterAbortFailure(operation: ActiveOperation): Promise<void> {
    this.terminating = undefined;
    if (operation.settled?.kind === "completed") {
      const completedAt = this.now();
      await this.terminals.finalize(
        operation,
        { lifecycle: "completed", settledAt: completedAt }
      );
      return;
    }
    if (operation.settled?.kind === "failed") {
      const failedAt = this.now();
      await this.terminals.finalize(
        operation,
        { lifecycle: "failed", settledAt: failedAt, error: operation.settled.error }
      );
      return;
    }
    this.active = operation;
  }

  private async poisonAfterAbortTimeout(operation: ActiveOperation): Promise<void> {
    if (this.terminating?.view.operationId !== operation.view.operationId) return;
    this.terminating = undefined;
    this.poisoned = true;
    const reason = `Pi abort did not settle within ${this.abortWatchdogMs} ms; Pi runtime service recovery is required.`;
    await this.terminals.lost(operation, reason, this.now());
    this.onRuntimePoisoned?.({
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: operation.view.operationId,
      abortTimeoutMs: this.abortWatchdogMs
    });
  }

  private assertHealthy(): void {
    if (!this.poisoned) return;
    if (this.receiptFailure) throw this.receiptFailure;
    throw new HostCommandError(
      "RUNTIME_POISONED",
      "The Pi runtime is poisoned and the Pi runtime service must be restarted.",
      true
    );
  }

  private async withDurability<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isOperationReceiptIntegrityError(error)) this.poisonForReceiptFailure(error);
      throw error;
    }
  }

  private poisonForReceiptFailure(error: HostCommandError): void {
    this.receiptFailure ??= error;
    this.poisoned = true;
    const operation = this.active ?? this.terminating;
    this.active = undefined;
    this.terminating = undefined;
    if (operation) {
      this.heartbeat.stop(operation.view.operationId);
      this.terminals.prepare(operation);
    }
    this.activity.reset();
    this.toolExecutions.reset();
  }
}
function shutdownResultFor(lifecycle: ActiveOperation["terminalLifecycle"]): OperationShutdownResult {
  return lifecycle === "cancelled" ? "cancelled" : lifecycle === "lost" ? "lost" : "none";
}
function acceptsPiQueue(kind: OperationKind): boolean { return kind === "prompt" || kind === "command"; }
function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer.`);
  return resolved;
}
