import type {
  OperationActivity,
  OperationKind,
  OperationView,
  RuntimeIdentity,
  RuntimeOperationActivity
} from "@pi67/domain";
import {
  createMessageId,
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
  type OperationHeartbeatControllerOptions
} from "./operation-heartbeat-controller.js";
import {
  assertCurrentOperationAuthority,
  assertOperationAuthority
} from "./operation-authority.js";
import {
  OperationTerminalLedger,
  type OperationTerminalDetails
} from "./operation-terminal-ledger.js";
import {
  authorityFromIdentity,
  OperationSubmissionLedger,
  type SubmissionAuthority
} from "./operation-submission-ledger.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";

interface ActiveOperation {
  view: OperationView;
  submissionId: string;
  abort?: () => Promise<void>;
  beforeTerminal?: () => void;
  terminalPrepared?: boolean;
  terminalLifecycle?: "completed" | "failed" | "cancelled" | "lost";
  settled?: { kind: "completed" } | { kind: "failed"; error: ProtocolError };
}

export type OperationShutdownResult = "none" | "cancelled" | "lost";

export interface AcceptOperationOptions {
  submissionId: string;
  fingerprint: string;
  kind: OperationKind;
  execute: () => Promise<void>;
  abort?: () => Promise<void>;
  beforeTerminal?: () => void;
}

export interface OperationRegistryOptions extends OperationHeartbeatControllerOptions {
  maxSubmissions?: number;
  abortWatchdogMs?: number;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
}
const DEFAULT_ABORT_WATCHDOG_MS = 10_000;

export class OperationRegistry {
  private active: ActiveOperation | undefined;
  private terminating: ActiveOperation | undefined;
  private readonly submissionLedger: OperationSubmissionLedger;
  private readonly terminalLedger: OperationTerminalLedger;
  private readonly activity: OperationActivityController;
  private readonly heartbeat: OperationHeartbeatController;
  private readonly maxSubmissions: number;
  private readonly abortWatchdogMs: number;
  private readonly now: () => number;
  private readonly onRuntimePoisoned: ((message: AgentHostRuntimePoisonedMessage) => void) | undefined;
  private poisoned = false;

  constructor(
    private readonly hostEpoch: number,
    private readonly getIdentity: () => RuntimeIdentity,
    private readonly emit: (event: AgentEvent) => void,
    options: OperationRegistryOptions = {}
  ) {
    this.maxSubmissions = positiveInteger(options.maxSubmissions, 512, "maxSubmissions");
    this.submissionLedger = new OperationSubmissionLedger(this.maxSubmissions, getIdentity);
    this.terminalLedger = new OperationTerminalLedger(hostEpoch, this.maxSubmissions);
    this.activity = new OperationActivityController(emit);
    this.abortWatchdogMs = positiveInteger(options.abortWatchdogMs, DEFAULT_ABORT_WATCHDOG_MS, "abortWatchdogMs");
    this.now = options.now ?? Date.now;
    this.heartbeat = new OperationHeartbeatController(emit, { ...options, now: this.now });
    this.onRuntimePoisoned = options.onRuntimePoisoned;
  }

  hasActive(): boolean { return this.poisoned || this.active !== undefined || this.terminating !== undefined; }
  isPoisoned(): boolean { return this.poisoned; }
  canAcceptQueue(): boolean { return this.active !== undefined && acceptsPiQueue(this.active.view.kind); }
  activeAccepted(): OperationAccepted | undefined {
    const operation = this.active ?? this.terminating;
    return operation ? this.toAccepted(operation.view) : undefined;
  }
  activeView(): OperationView | undefined { return (this.active ?? this.terminating)?.view; }
  updateActivity(activity: RuntimeOperationActivity): boolean {
    this.heartbeat.touch(this.active?.view.operationId);
    return this.activity.updateBase(this.active, activity);
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
  latestTerminal(): OperationSettled | undefined { return this.terminalLedger.latest(); }

  submissionFor(
    submissionId: string,
    fingerprint: string
  ): OperationSubmissionResult | Promise<OperationSubmissionResult> | undefined {
    this.assertHealthy();
    return this.submissionLedger.get(submissionId, fingerprint);
  }

  accept(options: AcceptOperationOptions): OperationSubmissionResult {
    const existing = this.submissionFor(options.submissionId, options.fingerprint);
    if (existing instanceof Promise) throw new HostCommandError("BUSY", "The submission is still being accepted.");
    if (existing) return existing;
    if (this.active) throw new HostCommandError("BUSY", "Another operation is already active.");
    const identity = this.requireSessionIdentity();
    this.activity.reset();
    const startedAt = this.now();
    const view: OperationView = {
      operationId: createMessageId("operation"),
      kind: options.kind,
      lifecycle: "running",
      cancellable: options.abort !== undefined,
      sessionId: identity.sessionId,
      sessionGeneration: identity.sessionGeneration,
      startedAt
    };
    this.active = {
      view,
      submissionId: options.submissionId,
      ...(options.abort === undefined ? {} : { abort: options.abort }),
      ...(options.beforeTerminal === undefined ? {} : { beforeTerminal: options.beforeTerminal })
    };
    this.heartbeat.start(view.operationId, startedAt);
    const accepted = this.rememberSubmission(
      options.submissionId,
      options.fingerprint,
      this.toAccepted(view),
      authorityFromIdentity(identity)
    );
    // Start on the next task so the accepted response is posted before operation events.
    setTimeout(() => {
      if (this.active?.view.operationId !== view.operationId) return;
      this.emit({ type: "operation.started", payload: { operation: view } });
      void options.execute().then(
        () => this.finishCompleted(view.operationId),
        (error: unknown) => this.finishFailed(view.operationId, toProtocolError(error))
      );
    }, 0);
    return accepted;
  }

  queueForActive(
    submissionId: string,
    fingerprint: string,
    execute: () => Promise<void>
  ): Promise<OperationSubmissionResult> {
    const existing = this.submissionFor(submissionId, fingerprint);
    if (existing) return Promise.resolve(existing);
    if (!this.active || !acceptsPiQueue(this.active.view.kind)) {
      throw new HostCommandError("OPERATION_NOT_FOUND", "There is no active turn operation to receive a queued prompt.");
    }
    const authority = authorityFromIdentity(this.requireSessionIdentity());
    assertOperationAuthority(authority, this.active.view);
    const accepted = this.toAccepted(this.active.view);
    const pending = execute()
      .then(() => {
        assertCurrentOperationAuthority(this.getIdentity(), authority);
        return this.rememberSubmission(submissionId, fingerprint, accepted, authority);
      })
      .finally(() => this.submissionLedger.deletePending(submissionId));
    this.submissionLedger.rememberPending(submissionId, fingerprint, pending, authority);
    return pending;
  }

  async abort(operationId: string | undefined): Promise<{ aborted: boolean; operationId?: string }> {
    this.assertHealthy();
    const active = this.active;
    if (!active || !active.abort || (operationId !== undefined && operationId !== active.view.operationId)) {
      return { aborted: false, ...(operationId === undefined ? {} : { operationId }) };
    }
    // Claim the terminal state before awaiting Pi so a resolving prompt cannot win the race.
    this.active = undefined;
    this.terminating = active;
    try {
      await withAbortWatchdog(active.abort(), this.abortWatchdogMs);
      const cancelledAt = this.now();
      this.finalizeTerminal(
        active,
        { lifecycle: "cancelled", settledAt: cancelledAt, reason: "Cancelled by the user." },
        {
          type: "operation.cancelled",
          payload: { operationId: active.view.operationId, cancelledAt, reason: "Cancelled by the user." }
        }
      );
    } catch (error) {
      if (error instanceof AbortWatchdogExpiredError) {
        this.poisonAfterAbortTimeout(active);
        throw new HostCommandError(
          "RUNTIME_POISONED",
          "Pi did not acknowledge abort before the safety watchdog expired.",
          true,
          { abortTimeoutMs: this.abortWatchdogMs }
        );
      }
      this.restoreAfterAbortFailure(active);
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
    if (wasAlreadyTerminating || !operation.abort || operation.terminalLifecycle) {
      this.finalizeLost(operation, reason);
      if (this.terminating?.view.operationId === operation.view.operationId) this.terminating = undefined;
      return "lost";
    }

    try {
      await withAbortWatchdog(operation.abort(), positiveInteger(timeoutMs, timeoutMs, "timeoutMs"));
      const cancelledAt = this.now();
      this.finalizeTerminal(
        operation,
        { lifecycle: "cancelled", settledAt: cancelledAt, reason },
        {
          type: "operation.cancelled",
          payload: { operationId: operation.view.operationId, cancelledAt, reason }
        }
      );
    } catch {
      this.finalizeLost(operation, reason);
    } finally {
      if (this.terminating?.view.operationId === operation.view.operationId) this.terminating = undefined;
    }
    return operation.terminalLifecycle === "cancelled" ? "cancelled" : "lost";
  }

  loseActive(reason: string): void {
    if (this.poisoned) return;
    const active = this.active;
    const terminating = this.terminating;
    if (!active && !terminating) return;
    this.active = undefined;
    this.terminating = undefined;
    this.activity.reset();
    const lost = active ?? terminating!;
    this.finalizeLost(lost, reason);
  }

  poisonSessionImportProjection(): boolean {
    if (this.poisoned) return false;
    const active = this.active;
    if (active?.view.kind !== "session-import") return false;
    this.active = undefined;
    this.poisoned = true;
    const reason = "The imported Pi Session became authoritative, but its projection could not be captured; Agent Host replacement is required.";
    this.finalizeLost(active, reason);
    this.onRuntimePoisoned?.({
      type: "agent-host-runtime-poisoned",
      code: "SESSION_IMPORT_PROJECTION_FAILED",
      operationId: active.view.operationId
    });
    return true;
  }

  private finishCompleted(operationId: string): void {
    if (this.terminating?.view.operationId === operationId) {
      this.terminating.settled = { kind: "completed" };
      this.prepareTerminal(this.terminating);
      return;
    }
    if (this.active?.view.operationId !== operationId) return;
    const completedAt = this.now();
    this.finalizeTerminal(
      this.active,
      { lifecycle: "completed", settledAt: completedAt },
      { type: "operation.completed", payload: { operationId, completedAt } }
    );
    this.active = undefined;
  }

  private finishFailed(operationId: string, error: ProtocolError): void {
    if (this.terminating?.view.operationId === operationId) {
      this.terminating.settled = { kind: "failed", error };
      this.prepareTerminal(this.terminating);
      return;
    }
    if (this.active?.view.operationId !== operationId) return;
    const failedAt = this.now();
    this.finalizeTerminal(
      this.active,
      { lifecycle: "failed", settledAt: failedAt, error },
      { type: "operation.failed", payload: { operationId, failedAt, error } }
    );
    this.active = undefined;
  }

  private restoreAfterAbortFailure(operation: ActiveOperation): void {
    this.terminating = undefined;
    if (operation.settled?.kind === "completed") {
      const completedAt = this.now();
      this.finalizeTerminal(
        operation,
        { lifecycle: "completed", settledAt: completedAt },
        { type: "operation.completed", payload: { operationId: operation.view.operationId, completedAt } }
      );
      return;
    }
    if (operation.settled?.kind === "failed") {
      const failedAt = this.now();
      this.finalizeTerminal(
        operation,
        { lifecycle: "failed", settledAt: failedAt, error: operation.settled.error },
        {
          type: "operation.failed",
          payload: { operationId: operation.view.operationId, failedAt, error: operation.settled.error }
        }
      );
      return;
    }
    this.active = operation;
  }

  private prepareTerminal(operation: ActiveOperation): void {
    if (operation.terminalPrepared) return;
    operation.terminalPrepared = true;
    operation.beforeTerminal?.();
  }

  private poisonAfterAbortTimeout(operation: ActiveOperation): void {
    if (this.terminating?.view.operationId !== operation.view.operationId) return;
    this.terminating = undefined;
    this.poisoned = true;
    const reason = `Pi abort did not settle within ${this.abortWatchdogMs} ms; Agent Host replacement is required.`;
    this.finalizeLost(operation, reason);
    this.onRuntimePoisoned?.({
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: operation.view.operationId,
      abortTimeoutMs: this.abortWatchdogMs
    });
  }

  private assertHealthy(): void {
    if (!this.poisoned) return;
    throw new HostCommandError(
      "RUNTIME_POISONED",
      "Pi runtime is poisoned and the Agent Host must be replaced.",
      true
    );
  }

  private requireSessionIdentity(): RuntimeIdentity & { sessionId: string } {
    const identity = this.getIdentity();
    if (!identity.sessionId) throw new HostCommandError("RUNTIME_NOT_READY", "Pi SDK runtime is not initialized.");
    return { ...identity, sessionId: identity.sessionId };
  }

  private toAccepted(view: OperationView): OperationAccepted {
    return {
      kind: "accepted",
      operationId: view.operationId,
      cancellable: view.cancellable,
      hostEpoch: this.hostEpoch,
      sessionId: view.sessionId,
      sessionGeneration: view.sessionGeneration
    };
  }

  private rememberSubmission(
    submissionId: string,
    fingerprint: string,
    accepted: OperationAccepted,
    authority: SubmissionAuthority
  ): OperationSubmissionResult {
    const terminal = this.terminalLedger.get(accepted.operationId);
    return this.submissionLedger.remember(
      submissionId,
      fingerprint,
      terminal ?? accepted,
      terminal
        ? { sessionId: terminal.sessionId, sessionGeneration: terminal.sessionGeneration }
        : authority
    );
  }

  private rememberTerminal(operation: ActiveOperation, details: OperationTerminalDetails): OperationSettled {
    const terminal = this.terminalLedger.remember(operation.view, this.getIdentity(), details);
    this.submissionLedger.updateTerminal(terminal);
    return terminal;
  }

  private finalizeLost(operation: ActiveOperation, reason: string): boolean {
    const lostAt = this.now();
    return this.finalizeTerminal(
      operation,
      { lifecycle: "lost", settledAt: lostAt, reason },
      { type: "operation.lost", payload: { operationId: operation.view.operationId, lostAt, reason } }
    );
  }

  private finalizeTerminal(
    operation: ActiveOperation,
    details: OperationTerminalDetails,
    event: AgentEvent
  ): boolean {
    if (operation.terminalLifecycle) return false;
    operation.terminalLifecycle = details.lifecycle;
    this.heartbeat.stop(operation.view.operationId);
    this.prepareTerminal(operation);
    this.rememberTerminal(operation, details);
    this.emit(event);
    this.activity.reset();
    return true;
  }
}

function acceptsPiQueue(kind: OperationKind): boolean {
  return kind === "prompt" || kind === "command";
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer.`);
  return resolved;
}
