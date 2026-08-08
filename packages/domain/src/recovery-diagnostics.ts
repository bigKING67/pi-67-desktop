export interface PromptAttachmentStagingDiagnostics {
  draftCount: number;
  claimedCount: number;
  invalidEntryCount: number;
  truncated: boolean;
}

export type PreviousRunExitStatus = "not-run" | "clean" | "unclean" | "unknown";

export type AgentHostLifecyclePhase =
  | "idle"
  | "starting"
  | "running"
  | "restart-scheduled"
  | "failed"
  | "stopping";

export interface DesktopRuntimeHealthDiagnostics {
  agentHost: {
    phase: AgentHostLifecyclePhase;
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
    restartScheduledAt?: number;
    restartCount: number;
    portHandoffCount: number;
    lastPortHandoffAt?: number;
    poisonedRuntimeReplacementCount: number;
    poisonedRuntimeReplacementPending: boolean;
  };
  repository: {
    mutationScheduler: {
      queuedCount: number;
      runningCount: number;
      activeRepositoryCount: number;
      fencedRepositoryCount: number;
      disposed: boolean;
    };
    gitRunner: {
      activeProcessCount: number;
      disposed: boolean;
    };
    workingTree: {
      cachedSnapshotCount: number;
      disposed: boolean;
    };
  };
  promptStashImages: {
    disposed: boolean;
  };
}

export interface DesktopRecoverySnapshot {
  generatedAt: number;
  previousRunExitStatus: PreviousRunExitStatus;
  workspaces: {
    total: number;
    available: number;
    missing: number;
    identityChanged: number;
    needsConfirmation: number;
    unavailable: number;
    trusted: number;
    trustUnknown: number;
    pathOnlyIdentity: number;
  };
  pendingSessionCreations: number;
  attachmentStaging: PromptAttachmentStagingDiagnostics;
  health: DesktopRuntimeHealthDiagnostics;
}
