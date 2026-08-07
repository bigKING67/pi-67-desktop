export interface PromptAttachmentStagingDiagnostics {
  draftCount: number;
  claimedCount: number;
  invalidEntryCount: number;
  truncated: boolean;
}

export type PreviousRunExitStatus = "not-run" | "clean" | "unclean" | "unknown";

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
}
