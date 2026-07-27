export type RendererSessionTransactionReason =
  | "workspace-replaced"
  | "session-replaced"
  | "projection-resync"
  | "connection-lost"
  | "host-replaced"
  | "session-control"
  | "session-import"
  | "runtime-crashed";

export interface RendererSessionTransactionPolicy {
  resetCatalog: boolean;
  clearConversation: boolean;
  resetChanges: boolean;
  resetTree: boolean;
  resetLiveTurn: boolean;
  resetInteractive: boolean;
  resetExtensionCatalog: boolean;
  resetProjection: boolean;
  preserveRecoverySessionPath: boolean;
}

export function rendererSessionTransactionPolicy(
  reason: RendererSessionTransactionReason
): RendererSessionTransactionPolicy {
  switch (reason) {
    case "workspace-replaced":
      return fullReset(true, false);
    case "projection-resync":
    case "connection-lost":
    case "host-replaced":
      return fullReset(true, true);
    case "session-replaced":
      return fullReset(false, true);
    case "runtime-crashed":
      return {
        resetCatalog: true,
        clearConversation: false,
        resetChanges: true,
        resetTree: true,
        resetLiveTurn: true,
        resetInteractive: true,
        resetExtensionCatalog: true,
        resetProjection: true,
        preserveRecoverySessionPath: true
      };
    case "session-control":
      return {
        resetCatalog: false,
        clearConversation: false,
        resetChanges: false,
        resetTree: false,
        resetLiveTurn: true,
        resetInteractive: true,
        resetExtensionCatalog: false,
        resetProjection: false,
        preserveRecoverySessionPath: true
      };
    case "session-import":
      return {
        resetCatalog: false,
        clearConversation: false,
        resetChanges: false,
        resetTree: false,
        resetLiveTurn: false,
        resetInteractive: true,
        resetExtensionCatalog: false,
        resetProjection: false,
        preserveRecoverySessionPath: true
      };
  }
}

function fullReset(
  resetCatalog: boolean,
  preserveRecoverySessionPath: boolean
): RendererSessionTransactionPolicy {
  return {
    resetCatalog,
    clearConversation: true,
    resetChanges: true,
    resetTree: true,
    resetLiveTurn: true,
    resetInteractive: true,
    resetExtensionCatalog: true,
    resetProjection: true,
    preserveRecoverySessionPath
  };
}
