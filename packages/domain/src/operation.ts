export type OperationKind = "prompt" | "command" | "compaction" | "session-import";

export type OperationLifecycle =
  | "submitting"
  | "accepted"
  | "running"
  | "waiting-input"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

export type ToolPresentationKind =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "managed-process"
  | "subagent"
  | "image"
  | "approval"
  | "extension"
  | "generic";

export type OperationActivity =
  | { kind: "thinking" }
  | { kind: "responding" }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      toolKind: ToolPresentationKind;
      status: "running" | "completed" | "failed";
      aliasTarget?: string;
    }
  | { kind: "approval"; requestId: string }
  | { kind: "extension-input"; requestId: string }
  | { kind: "compaction" };

export type RuntimeOperationActivity = Exclude<
  OperationActivity,
  { kind: "approval" } | { kind: "extension-input" }
> | null;

export type OperationFreshnessPhase = "fresh" | "quiet" | "stalled" | "recovering";

export type OperationFreshnessReason = "activity-quiet" | "heartbeat-overdue";

export interface OperationFreshness {
  operationId: string;
  phase: OperationFreshnessPhase;
  lastActivityAt: number;
  lastHeartbeatAt: number;
  observedAt: number;
  reason?: OperationFreshnessReason;
}

export interface OperationView {
  operationId: string;
  kind: OperationKind;
  lifecycle: OperationLifecycle;
  cancellable: boolean;
  sessionId: string;
  sessionGeneration: number;
  startedAt: number;
  activity?: OperationActivity;
}

export interface RuntimeIdentity {
  sessionId?: string;
  sessionPath?: string;
  sessionGeneration: number;
}
