import type { AgentEvent } from "@pi67/protocol";

const OPERATION_HEARTBEAT_INTERVAL_MS = 5_000;

export interface OperationHeartbeatControllerOptions {
  heartbeatIntervalMs?: number;
  now?: () => number;
  scheduleHeartbeat?: (callback: () => void, intervalMs: number) => unknown;
  cancelHeartbeat?: (handle: unknown) => void;
}

interface HeartbeatState {
  operationId: string;
  lastActivityAt: number;
}

export interface OperationHeartbeatDiagnostics {
  active: boolean;
  lastActivityAt?: number;
  quietForMs?: number;
}

export class OperationHeartbeatController {
  private readonly heartbeatIntervalMs: number;
  private readonly now: () => number;
  private readonly scheduleHeartbeat: (callback: () => void, intervalMs: number) => unknown;
  private readonly cancelHeartbeat: (handle: unknown) => void;
  private current: HeartbeatState | undefined;
  private timer: unknown;

  constructor(
    private readonly emit: (event: AgentEvent) => void,
    options: OperationHeartbeatControllerOptions = {}
  ) {
    this.heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs,
      OPERATION_HEARTBEAT_INTERVAL_MS,
      "heartbeatIntervalMs"
    );
    this.now = options.now ?? Date.now;
    this.scheduleHeartbeat = options.scheduleHeartbeat ?? scheduleOperationHeartbeat;
    this.cancelHeartbeat = options.cancelHeartbeat ?? cancelOperationHeartbeat;
  }

  start(operationId: string, startedAt: number): void {
    this.stop();
    this.current = { operationId, lastActivityAt: startedAt };
    this.timer = this.scheduleHeartbeat(() => this.emitHeartbeat(operationId), this.heartbeatIntervalMs);
  }

  touch(operationId: string | undefined): boolean {
    if (!this.current || operationId !== this.current.operationId) return false;
    this.current.lastActivityAt = Math.max(this.current.lastActivityAt, this.now());
    return true;
  }

  observeEvent(event: AgentEvent, operationId: string | undefined): boolean {
    if (!isBusinessActivityEvent(event) || !eventBelongsToOperation(event, operationId)) return false;
    return this.touch(operationId);
  }

  diagnostics(): OperationHeartbeatDiagnostics {
    if (!this.current) return { active: false };
    return {
      active: true,
      lastActivityAt: this.current.lastActivityAt,
      quietForMs: Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(0, this.now() - this.current.lastActivityAt)
      )
    };
  }

  stop(operationId?: string): void {
    if (operationId !== undefined && this.current?.operationId !== operationId) return;
    if (this.timer !== undefined) this.cancelHeartbeat(this.timer);
    this.timer = undefined;
    this.current = undefined;
  }

  private emitHeartbeat(operationId: string): void {
    if (!this.current || this.current.operationId !== operationId) return;
    const observedAt = Math.max(this.now(), this.current.lastActivityAt);
    this.emit({
      type: "operation.heartbeat",
      payload: { operationId, observedAt, lastActivityAt: this.current.lastActivityAt }
    });
  }
}

function isBusinessActivityEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case "turn.streamBatch":
    case "operation.started":
    case "operation.activityChanged":
    case "operation.progress":
    case "workspace.changeChanged":
    case "approval.requested":
    case "approval.resolved":
    case "approval.cancelled":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.ui.resolved":
    case "extension.ui.cancelled":
      return true;
    default:
      return false;
  }
}

function eventBelongsToOperation(event: AgentEvent, operationId: string | undefined): boolean {
  if (operationId === undefined) return false;
  if (event.type === "operation.started") return event.payload.operation.operationId === operationId;
  if (event.type.startsWith("operation.")) {
    return (event.payload as { operationId: string }).operationId === operationId;
  }
  return true;
}

function scheduleOperationHeartbeat(callback: () => void, intervalMs: number): unknown {
  const handle = setInterval(callback, intervalMs);
  if (typeof handle === "object" && handle !== null && "unref" in handle) {
    (handle as { unref?: () => void }).unref?.();
  }
  return handle;
}

function cancelOperationHeartbeat(handle: unknown): void {
  clearInterval(handle as ReturnType<typeof setInterval>);
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer.`);
  return resolved;
}
