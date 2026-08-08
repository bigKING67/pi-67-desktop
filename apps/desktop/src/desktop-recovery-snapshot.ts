import type {
  DesktopRecoverySnapshot,
  DesktopRuntimeHealthDiagnostics,
  PreviousRunExitStatus,
  PromptAttachmentStagingDiagnostics
} from "@pi67/protocol";
import type { WorkbenchLoadResult, WorkbenchStateV5 } from "./workbench-state.js";

export function previousRunExitStatus(loadResult: WorkbenchLoadResult): PreviousRunExitStatus {
  if (loadResult.recovery?.kind === "initialized") return "not-run";
  if (loadResult.recovery?.kind === "corrupt-reset") return "unknown";
  return loadResult.state.cleanExit ? "clean" : "unclean";
}

export function createDesktopRecoverySnapshot(
  state: WorkbenchStateV5,
  previousRunExit: PreviousRunExitStatus,
  attachmentStaging: PromptAttachmentStagingDiagnostics,
  health: DesktopRuntimeHealthDiagnostics,
  generatedAt = Date.now()
): DesktopRecoverySnapshot {
  const workspaces = {
    total: state.workspaces.length,
    available: 0,
    missing: 0,
    identityChanged: 0,
    needsConfirmation: 0,
    unavailable: 0,
    trusted: 0,
    trustUnknown: 0,
    pathOnlyIdentity: 0
  };
  for (const workspace of state.workspaces) {
    switch (workspace.availability) {
      case "available": workspaces.available += 1; break;
      case "missing": workspaces.missing += 1; break;
      case "identity-changed": workspaces.identityChanged += 1; break;
      case "needs-confirmation": workspaces.needsConfirmation += 1; break;
      case "unavailable": workspaces.unavailable += 1; break;
    }
    if (workspace.trust === "trusted") workspaces.trusted += 1;
    if (workspace.trust === "unknown") workspaces.trustUnknown += 1;
    if (workspace.identity.assurance === "path-only") workspaces.pathOnlyIdentity += 1;
  }
  return {
    generatedAt,
    previousRunExitStatus: previousRunExit,
    workspaces,
    pendingSessionCreations: state.sessionCreationRecovery.length,
    attachmentStaging: { ...attachmentStaging },
    health
  };
}
