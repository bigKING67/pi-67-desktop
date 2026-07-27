export type AgentHostRuntimePoisonedMessage = {
  type: "agent-host-runtime-poisoned";
  code: "ABORT_WATCHDOG_EXPIRED";
  operationId: string;
  abortTimeoutMs: number;
} | {
  type: "agent-host-runtime-poisoned";
  code: "SESSION_IMPORT_PROJECTION_FAILED";
  operationId: string;
};

export interface AgentHostShutdownRequest {
  type: "agent-host-shutdown";
  reason: "application-quit";
  deadlineMs: number;
}

export interface AgentHostShutdownCompleteMessage {
  type: "agent-host-shutdown-complete";
  activeOperation: "none" | "cancelled" | "lost";
  queuedCommandsDropped: number;
  extensionRequestsCancelled: number;
}

export function isAgentHostRuntimePoisonedMessage(
  value: unknown
): value is AgentHostRuntimePoisonedMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as {
    type?: unknown;
    code?: unknown;
    operationId?: unknown;
    abortTimeoutMs?: unknown;
  };
  if (
    message.type !== "agent-host-runtime-poisoned"
    || typeof message.operationId !== "string"
    || message.operationId.length === 0
    || message.operationId.length > 512
  ) return false;
  if (message.code === "SESSION_IMPORT_PROJECTION_FAILED") {
    return Object.keys(value).length === 3;
  }
  return message.code === "ABORT_WATCHDOG_EXPIRED"
    && Object.keys(value).length === 4
    && Number.isSafeInteger(message.abortTimeoutMs)
    && Number(message.abortTimeoutMs) >= 1
    && Number(message.abortTimeoutMs) <= 60_000;
}

export function isAgentHostShutdownRequest(value: unknown): value is AgentHostShutdownRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<AgentHostShutdownRequest>;
  return Object.keys(value).length === 3
    && message.type === "agent-host-shutdown"
    && message.reason === "application-quit"
    && Number.isSafeInteger(message.deadlineMs)
    && Number(message.deadlineMs) >= 100
    && Number(message.deadlineMs) <= 10_000;
}

export function isAgentHostShutdownCompleteMessage(
  value: unknown
): value is AgentHostShutdownCompleteMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<AgentHostShutdownCompleteMessage>;
  return Object.keys(value).length === 4
    && message.type === "agent-host-shutdown-complete"
    && (
      message.activeOperation === "none"
      || message.activeOperation === "cancelled"
      || message.activeOperation === "lost"
    )
    && boundedCount(message.queuedCommandsDropped)
    && boundedCount(message.extensionRequestsCancelled);
}

function boundedCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;
}
