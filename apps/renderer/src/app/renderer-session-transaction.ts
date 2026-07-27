import { resetApprovalState } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { resetConversationRequests } from "../conversation/conversation-controller.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import {
  resetExtensionUiCatalogState,
  resetExtensionUiInteractiveState
} from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { invalidateSessionImportBootstrapWatchdog } from "./session-import-bootstrap-watchdog.js";
import {
  rendererSessionTransactionPolicy,
  type RendererSessionTransactionReason
} from "./renderer-session-transaction-policy.js";

export function prepareRendererSessionTransaction(
  reason: RendererSessionTransactionReason
): void {
  invalidateSessionImportBootstrapWatchdog();
  const policy = rendererSessionTransactionPolicy(reason);
  resetConversationRequests();
  if (policy.resetProjection) {
    useSessionProjectionStore.getState().reset({
      preserveRecoverySessionPath: policy.preserveRecoverySessionPath
    });
  }
  if (policy.resetCatalog) useSessionCatalogStore.getState().reset();
  if (policy.clearConversation) useConversationStore.getState().reset();
  else useConversationStore.getState().invalidateProjection();
  if (policy.resetChanges) useWorkspaceChangesStore.getState().reset("stale");
  if (policy.resetTree) useSessionTreeStore.getState().reset("stale");
  if (policy.resetLiveTurn) useLiveTurnStore.getState().reset();
  if (policy.resetInteractive) resetRendererSessionInteractiveState();
  if (policy.resetExtensionCatalog) resetExtensionUiCatalogState();
}

export function resetRendererSessionInteractiveState(): void {
  resetApprovalState();
  resetExtensionUiInteractiveState();
}
