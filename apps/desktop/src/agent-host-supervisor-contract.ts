import type { BrowserWindow } from "electron";
import type {
  AgentHostLifecyclePhase,
  AgentHostProfileMode,
  AgentHostShutdownCompleteMessage,
  AgentHostStartupIssue,
  AgentHostStartupState
} from "@pi67/protocol";

export interface AgentHostStopResult {
  graceful: boolean;
  forced: boolean;
  activeOperation: AgentHostShutdownCompleteMessage["activeOperation"];
  queuedCommandsDropped: number;
  extensionRequestsCancelled: number;
}

export type AgentHostSupervisorPhase = AgentHostLifecyclePhase;

export interface AgentHostSupervisorDiagnostics {
  phase: AgentHostSupervisorPhase;
  hostEpoch?: number;
  processStartRequestedAt?: number;
  processStartedAt?: number;
  lastSpawnDurationMs?: number;
  lastExit?: {
    at: number;
    code: number;
    recoverable: boolean;
    attempt?: number;
  };
  lastStartup?: AgentHostStartupState & {
    at: number;
    hostEpoch: number;
  };
  lastStartupFailure?: {
    at: number;
    hostEpoch: number;
    profileMode?: AgentHostProfileMode;
    issue: AgentHostStartupIssue;
  };
  restartScheduledAt?: number;
  restartCount: number;
  portHandoffCount: number;
  lastPortHandoffAt?: number;
  poisonedRuntimeReplacementCount: number;
  poisonedRuntimeReplacementPending: boolean;
}

export function rendererDocumentHandoffKey(
  window: BrowserWindow,
  hostEpoch: number
): string | undefined {
  const webContents = window.webContents;
  if (webContents.isDestroyed()) return undefined;
  const frame = webContents.mainFrame;
  return `${hostEpoch}:${webContents.id}:${frame.processId}:${frame.routingId}`;
}

export function resolveAgentHostShutdownDeadline(
  value: number | undefined,
  defaultValue: number
): number {
  const resolved = value ?? defaultValue;
  if (!Number.isSafeInteger(resolved) || resolved < 100 || resolved > 10_000) {
    throw new RangeError("shutdownDeadlineMs must be an integer between 100 and 10000.");
  }
  return resolved;
}

export function emptyAgentHostStopResult(
  graceful: boolean,
  forced: boolean
): AgentHostStopResult {
  return {
    graceful,
    forced,
    activeOperation: "none",
    queuedCommandsDropped: 0,
    extensionRequestsCancelled: 0
  };
}
