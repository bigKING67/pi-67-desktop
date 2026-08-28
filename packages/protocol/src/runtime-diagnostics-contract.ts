import type { SessionCatalogStatus } from "@pi67/domain";

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
  workspaces: Array<{
    workspaceIdHash: string;
    sessionCatalog: SessionCatalogStatus;
    sessionCreationJournal: SessionCreationJournalDiagnostics;
  }>;
  workspacesTruncated: boolean;
}
