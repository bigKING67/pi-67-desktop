import type { OperationFreshness, OperationView } from "@pi67/domain";

const OPERATION_FRESHNESS_THRESHOLDS = {
  activityQuietAfterMs: 60_000,
  heartbeatStalledAfterMs: 15_000,
  heartbeatRecoveryAfterMs: 30_000
} as const;

export interface OperationWatchdogAuthority {
  hostEpoch: number;
  operationId: string;
  sessionId: string;
  sessionGeneration: number;
}

interface OperationHeartbeatObservation {
  operationId: string;
  observedAt: number;
  lastActivityAt: number;
}

interface OperationFreshnessThresholds {
  activityQuietAfterMs: number;
  heartbeatStalledAfterMs: number;
  heartbeatRecoveryAfterMs: number;
}

interface OperationFreshnessWatchdogOptions {
  thresholds?: OperationFreshnessThresholds;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  onFreshness: (freshness: OperationFreshness, authority: OperationWatchdogAuthority) => void;
  onRecover: (authority: OperationWatchdogAuthority) => void;
}

interface ActiveWatch {
  authority: OperationWatchdogAuthority;
  lastActivityAt: number;
  lastHeartbeatAt: number;
  waitingForInput: boolean;
  recoveryRequested: boolean;
}

export class OperationFreshnessWatchdog {
  private readonly thresholds: OperationFreshnessThresholds;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private active: ActiveWatch | undefined;
  private timer: unknown;

  constructor(private readonly options: OperationFreshnessWatchdogOptions) {
    this.thresholds = validatedThresholds(options.thresholds ?? OPERATION_FRESHNESS_THRESHOLDS);
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  track(operation: OperationView, hostEpoch: number): void {
    if (!isActiveOperation(operation)) {
      this.stop(operation.operationId);
      return;
    }
    const authority = authorityFor(operation, hostEpoch);
    const waitingForInput = operation.lifecycle === "waiting-input"
      || operation.activity?.kind === "approval"
      || operation.activity?.kind === "extension-input";
    if (this.active && sameAuthority(this.active.authority, authority)) {
      if (this.active.waitingForInput !== waitingForInput) {
        const now = this.now();
        this.active.waitingForInput = waitingForInput;
        if (!waitingForInput) {
          this.active.lastActivityAt = now;
          this.active.lastHeartbeatAt = now;
          this.active.recoveryRequested = false;
        }
        this.evaluate(now);
      }
      return;
    }

    const now = this.now();
    this.clearTimer();
    this.active = {
      authority,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      waitingForInput,
      recoveryRequested: false
    };
    this.evaluate(now);
  }

  observeBusinessActivity(authority: OperationWatchdogAuthority): boolean {
    if (!this.active || !sameAuthority(this.active.authority, authority)) return false;
    const now = this.now();
    this.active.lastActivityAt = now;
    this.active.lastHeartbeatAt = now;
    this.active.recoveryRequested = false;
    this.evaluate(now);
    return true;
  }

  observeHeartbeat(
    authority: OperationWatchdogAuthority,
    heartbeat: OperationHeartbeatObservation
  ): boolean {
    if (
      !this.active
      || !sameAuthority(this.active.authority, authority)
      || heartbeat.operationId !== authority.operationId
    ) return false;
    const now = this.now();
    const activityAge = Math.max(0, heartbeat.observedAt - heartbeat.lastActivityAt);
    this.active.lastHeartbeatAt = now;
    this.active.lastActivityAt = Math.max(0, now - activityAge);
    this.active.recoveryRequested = false;
    this.evaluate(now);
    return true;
  }

  handlePowerResume(): void {
    if (!this.active) return;
    const now = this.now();
    this.active.lastActivityAt = now;
    this.active.lastHeartbeatAt = now;
    this.active.recoveryRequested = false;
    this.evaluate(now);
  }

  stop(operationId?: string): void {
    if (operationId !== undefined && this.active?.authority.operationId !== operationId) return;
    this.clearTimer();
    this.active = undefined;
  }

  private evaluate(now: number): void {
    const active = this.active;
    if (!active) return;
    const freshness = projectFreshness(active, now, this.thresholds);
    this.options.onFreshness(freshness, active.authority);
    this.scheduleNext(now);
    if (freshness.phase === "recovering" && !active.recoveryRequested) {
      active.recoveryRequested = true;
      this.options.onRecover(active.authority);
    }
  }

  private scheduleNext(now: number): void {
    this.clearTimer();
    const active = this.active;
    if (!active || active.waitingForInput || active.recoveryRequested) return;
    const heartbeatStalledAt = active.lastHeartbeatAt + this.thresholds.heartbeatStalledAfterMs;
    const heartbeatRecoveryAt = active.lastHeartbeatAt + this.thresholds.heartbeatRecoveryAfterMs;
    const activityQuietAt = active.lastActivityAt + this.thresholds.activityQuietAfterMs;
    const deadlines = [heartbeatStalledAt, heartbeatRecoveryAt, activityQuietAt]
      .filter((deadline) => deadline > now);
    if (deadlines.length === 0) return;
    const nextDeadline = Math.min(...deadlines);
    this.timer = this.schedule(() => this.evaluate(this.now()), nextDeadline - now);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.cancel(this.timer);
    this.timer = undefined;
  }
}

function projectFreshness(
  active: ActiveWatch,
  observedAt: number,
  thresholds: OperationFreshnessThresholds
): OperationFreshness {
  const heartbeatAge = observedAt - active.lastHeartbeatAt;
  const activityAge = observedAt - active.lastActivityAt;
  const phase = active.waitingForInput
    ? "fresh"
    : heartbeatAge >= thresholds.heartbeatRecoveryAfterMs
      ? "recovering"
      : heartbeatAge >= thresholds.heartbeatStalledAfterMs
        ? "stalled"
        : activityAge >= thresholds.activityQuietAfterMs
          ? "quiet"
          : "fresh";
  return {
    operationId: active.authority.operationId,
    phase,
    lastActivityAt: active.lastActivityAt,
    lastHeartbeatAt: active.lastHeartbeatAt,
    observedAt,
    ...(phase === "quiet"
      ? { reason: "activity-quiet" as const }
      : phase === "stalled" || phase === "recovering"
        ? { reason: "heartbeat-overdue" as const }
        : {})
  };
}

function authorityFor(operation: OperationView, hostEpoch: number): OperationWatchdogAuthority {
  return {
    hostEpoch,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    sessionGeneration: operation.sessionGeneration
  };
}

function sameAuthority(left: OperationWatchdogAuthority, right: OperationWatchdogAuthority): boolean {
  return left.hostEpoch === right.hostEpoch
    && left.operationId === right.operationId
    && left.sessionId === right.sessionId
    && left.sessionGeneration === right.sessionGeneration;
}

function isActiveOperation(operation: OperationView): boolean {
  return operation.lifecycle === "submitting"
    || operation.lifecycle === "accepted"
    || operation.lifecycle === "running"
    || operation.lifecycle === "waiting-input";
}

function validatedThresholds(thresholds: OperationFreshnessThresholds): OperationFreshnessThresholds {
  const values = Object.values(thresholds);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError("Operation freshness thresholds must be positive integers.");
  }
  if (thresholds.heartbeatRecoveryAfterMs <= thresholds.heartbeatStalledAfterMs) {
    throw new RangeError("Operation heartbeat recovery threshold must be greater than its stalled threshold.");
  }
  return thresholds;
}
