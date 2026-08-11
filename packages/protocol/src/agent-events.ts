import type {
  ApprovalRequestView,
  ActiveProposedPlan,
  DoctorReport,
  ExtensionCatalogResult,
  ExtensionCompatibilityEventView,
  ExtensionUiCancellationReason,
  ExtensionUiRequestView,
  OperationActivity,
  OperationView,
  PlanLifecycleChange,
  RuntimeCapabilities,
  RuntimeStatus,
  SessionCatalogChangedEvent,
  SessionModelCatalogResult,
  SessionSnapshot,
  SessionInteractionMode,
  TaskToolMode,
  ToolExecutionView,
  ApprovalResponseDecision,
  WorkspaceChangeView
} from "@pi67/domain";
import type { ProtocolError } from "./protocol-error.js";
import type { PiProviderConfigurationChanged } from "./provider-configuration-schemas.js";

export interface StreamDelta {
  assistantMessageEvent: {
    type: "text_delta" | "thinking_delta";
    delta: string;
  };
}

export interface EventPayloads {
  "runtime.statusChanged": RuntimeStatus;
  "runtime.ready": {
    capabilities: RuntimeCapabilities;
    snapshot: SessionSnapshot;
    taskToolMode: TaskToolMode;
  };
  "runtime.crashed": { detail: string; recoverable: boolean };
  "session.bootstrap": {
    snapshot: SessionSnapshot;
    reason: "session-create" | "session-open" | "session-fork" | "session-import";
  };
  "conversation.changed": {
    sessionId: string;
    reason: "user-appended" | "settled" | "compacted" | "rolled-back";
  };
  "queue.changed": { steeringQueue: string[]; followUpQueue: string[] };
  "session.metaChanged": {
    streaming: boolean;
    sessionName?: string;
    thinkingLevel: string;
    selectedModel?: { provider: string; id: string };
  };
  "session.interactionModeChanged": { interactionMode: SessionInteractionMode };
  "plan.proposed": { plan: ActiveProposedPlan };
  "plan.lifecycleChanged": PlanLifecycleChange;
  "model.catalog.changed": SessionModelCatalogResult;
  "tree.changed": { reason: "session-entry" | "compacted" | "rollback" };
  "usage.changed": { tokens: number; cost: number; contextPercent?: number };
  "session.catalog.changed": SessionCatalogChangedEvent;
  "session.externalChangeDetected": {
    reason: "appended" | "truncated" | "replaced" | "unavailable" | "invalid";
    recoverable: boolean;
  };
  "provider.configuration.changed": PiProviderConfigurationChanged;
  "turn.streamBatch": { events: StreamDelta[] };
  "operation.started": { operation: OperationView };
  "operation.heartbeat": { operationId: string; observedAt: number; lastActivityAt: number };
  "operation.activityChanged": { operationId: string; activity: OperationActivity | null };
  "operation.toolExecutionChanged": { operationId: string; execution: ToolExecutionView };
  "operation.progress": { operationId: string; message: string; current?: number; total?: number };
  "operation.completed": { operationId: string; completedAt: number };
  "operation.failed": { operationId: string; failedAt: number; error: ProtocolError };
  "operation.cancelled": { operationId: string; cancelledAt: number; reason: string };
  "operation.lost": { operationId: string; lostAt: number; reason: string };
  "workspace.changeChanged": { sessionId: string; change: WorkspaceChangeView };
  "approval.requested": ApprovalRequestView;
  "approval.resolved": {
    requestId: string;
    toolCallId: string;
    decision: ApprovalResponseDecision;
  };
  "approval.cancelled": {
    requests: Array<{ requestId: string; toolCallId: string }>;
    reason: ExtensionUiCancellationReason;
  };
  "task.toolMode.changed": {
    mode: TaskToolMode;
    reason: "user-selected" | "approval-enabled-yolo" | "trust-revoked" | "runtime-reset";
  };
  "extension.ui.requested": ExtensionUiRequestView;
  "extension.ui.updated": ExtensionUiRequestView;
  "extension.ui.resolved": { requestId: string; cancelled: boolean };
  "extension.ui.cancelled": { requestIds: string[]; reason: ExtensionUiCancellationReason };
  "extension.compatibilityChanged": ExtensionCompatibilityEventView;
  "extension.catalog.changed": ExtensionCatalogResult;
  "resource.changed": { reason: string };
  "diagnostics.progress": { step: string; completed: boolean };
  "doctor.completed": DoctorReport;
}

export type AgentEventType = keyof EventPayloads;

export type AgentEvent<T extends AgentEventType = AgentEventType> = {
  [K in T]: { type: K; payload: EventPayloads[K] };
}[T];
