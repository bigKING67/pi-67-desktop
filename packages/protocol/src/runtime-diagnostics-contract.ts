import type { SessionCatalogStatus } from "@pi67/domain";
import type {
  SupportDiagnosticAction,
  SupportDiagnosticIncident
} from "@pi67/support-contract";

export type {
  SupportDiagnosticAction,
  SupportDiagnosticActionName,
  SupportDiagnosticActionStage,
  SupportDiagnosticErrorClass,
  SupportDiagnosticIncident,
  SupportDiagnosticIncidentLayer,
  SupportDiagnosticIncidentOutcome,
  SupportDiagnosticIncidentPhase,
  SupportDiagnosticIncidentReason
} from "@pi67/support-contract";

export type RendererConnectionTeardownReason =
  | "port-closed"
  | "message-decode-failed"
  | "handshake-timeout"
  | "handshake-send-failed"
  | "handshake-rejected"
  | "handshake-identity-mismatch"
  | "protocol-violation"
  | "request-send-failed"
  | "request-cancellation-send-failed"
  | "disposed";

export interface RuntimeDiagnostics {
  generatedAt: number;
  application: string;
  piSdkVersion: string;
  platform: string;
  architecture: string;
  node: string;
  workspace?: { pathHash: string; pathKind: "drive" | "unc" | "posix" };
  sessionConfigured: boolean;
  sessionFileConfigured: boolean;
  model?: string;
  extensionCount: number;
  extensionErrors: Array<{ sourceHash: string; errorClass: string }>;
  toolExecutionReceiptFailureCount: number;
  host?: RuntimeHostDiagnostics;
}

export type RuntimeDiagnosticsCollectionFailure =
  | "acknowledgement-timeout"
  | "connection-unavailable"
  | "host-replaced"
  | "protocol-error"
  | "unknown";

export interface RendererAcknowledgementDiagnostics {
  activeRequestCount: number;
  sampleCount: number;
  slowAcknowledgementCount: number;
  slowThresholdMs: number;
  lastAcknowledgementLatencyMs?: number;
  maxAcknowledgementLatencyMs?: number;
  connectionGeneration?: number;
  teardownCount?: number;
  futureGenerationWaitCount?: number;
  futureGenerationWaitTimeoutCount?: number;
  priorGenerationTeardownIgnoredCount?: number;
  consecutiveUnstableConnectionCount?: number;
  automaticReplacementSuppressedCount?: number;
  lastTeardownAt?: number;
  lastTeardownCode?: string;
  lastTeardownReason?: RendererConnectionTeardownReason;
  causality?: {
    actions: SupportDiagnosticAction[];
    actionsDroppedCount: number;
    incidents: SupportDiagnosticIncident[];
    incidentsDroppedCount: number;
  };
}

export type SupportDiagnosticsExportRequest =
  | {
      runtimeCollection: { status: "available" };
      runtime: RuntimeDiagnostics;
      renderer: RendererAcknowledgementDiagnostics;
    }
  | {
      runtimeCollection: {
        status: "unavailable";
        failure: RuntimeDiagnosticsCollectionFailure;
      };
      renderer: RendererAcknowledgementDiagnostics;
    };

export interface SessionCreationJournalDiagnostics {
  entryCount: number;
  stateCounts: Record<
    "reserved" | "materializing" | "materialized" | "published" | "acknowledged" | "ambiguous" | "abandoned",
    number
  >;
  invalidEntryCount: number;
  truncated: boolean;
}

export type RuntimeInitializationStageDiagnostics =
  | "resolve-session"
  | "dispose-current"
  | "create-session"
  | "load-model-runtime"
  | "validate-packages"
  | "load-session-resources"
  | "activate-session"
  | "reload-configuration"
  | "project-snapshot";

export interface RuntimeInitializationReceiptDiagnostics {
  outcome: "in-progress" | "completed" | "failed";
  stages: Array<{
    stage: RuntimeInitializationStageDiagnostics;
    outcome: "started" | "completed" | "failed";
    durationMs: number;
  }>;
  stagesTruncated: boolean;
}

export interface RuntimeHostDiagnostics {
  hostEpoch: number;
  taskCount: number;
  liveRuntimeCount: number;
  activeOperationCount: number;
  scheduler: {
    taskCount: number;
    activeQueryCount: number;
    queuedControlCount: number;
    runningControlCount: number;
    queuedPromptCount: number;
    runningPromptCount: number;
    turnAdmissionCount: number;
    closedCount: number;
  };
  operations: {
    registryCount: number;
    acceptingCount: number;
    activeCount: number;
    terminatingCount: number;
    poisonedCount: number;
    heartbeatTrackedCount: number;
    maxQuietForMs: number;
  };
  writerLeases: { activeCount: number; pendingCount: number; compromised: boolean };
  initializationReceipts?: {
    receipts: RuntimeInitializationReceiptDiagnostics[];
    receiptsTruncated: boolean;
  };
  causality?: {
    incidents: SupportDiagnosticIncident[];
    incidentsDroppedCount: number;
  };
  workspaces: Array<{
    workspaceIdHash: string;
    sessionCatalog: SessionCatalogStatus;
    sessionCreationJournal: SessionCreationJournalDiagnostics;
  }>;
  workspacesTruncated: boolean;
}
