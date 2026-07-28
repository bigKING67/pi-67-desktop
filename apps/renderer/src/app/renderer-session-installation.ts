import type { SessionSnapshot } from "@pi67/domain";
import type { ProjectionResyncResult } from "@pi67/protocol";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { matchingStagedExtensionCatalog } from "../extension-ui/extension-catalog-transition.js";
import {
  resetExtensionUiCatalogState,
  useExtensionUiStore
} from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { featureProjectionAuthorityFromInstallation } from "../session/session-projection-authority.js";
import {
  useSessionProjectionStore,
  type SessionProjectionInstallation,
  type SessionProjectionTransitionTarget
} from "../session/session-projection-store.js";
import type { RendererSessionAuthorityState } from "../session/session-authority.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import {
  resetRendererSessionInteractiveState
} from "./renderer-session-transaction.js";
import { resetConversationRequests } from "../conversation/conversation-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

interface RendererSessionInstallationOptions {
  sessionGeneration?: number;
  transitionTarget?: SessionProjectionTransitionTarget;
  operationId?: string;
  stageAdditionalProjections?: (
    installation: SessionProjectionInstallation,
    isCurrent: () => boolean
  ) => boolean;
}

export function replaceRendererSessionSnapshot(
  state: RendererSessionAuthorityState,
  snapshot: SessionSnapshot,
  options: Omit<RendererSessionInstallationOptions, "stageAdditionalProjections"> = {}
): boolean {
  return installRendererSessionSnapshot(state, snapshot, options);
}

export function installRendererSessionResync(
  state: RendererSessionAuthorityState,
  result: ProjectionResyncResult,
  hostEpoch: number,
  transitionTarget: SessionProjectionTransitionTarget
): boolean {
  if (
    result.hostEpoch !== hostEpoch
    || result.changes.sessionId !== result.snapshot.sessionId
  ) return false;
  return installRendererSessionSnapshot(
    state,
    result.snapshot,
    {
      sessionGeneration: result.sessionGeneration,
      transitionTarget,
      stageAdditionalProjections: (installation, isCurrent) => {
        const projectionAuthority = featureProjectionAuthorityFromInstallation(installation);
        useExtensionUiStore.getState().installCatalog(projectionAuthority, result.extensionCatalog);
        if (!isCurrent()) return false;
        if (!useWorkspaceChangesStore.getState().installProjection(
          projectionAuthority,
          result.changes
        )) return false;
        if (!isCurrent()) return false;
        const workspaceId = rendererWorkbenchStore.getState().currentWorkspaceId;
        if (workspaceId) {
          useSessionCatalogStore.getState().applyStatus(workspaceId, result.sessionCatalogStatus);
        } else {
          useSessionCatalogStore.getState().applyStatus(result.sessionCatalogStatus);
        }
        return isCurrent();
      }
    }
  );
}

function installRendererSessionSnapshot(
  state: RendererSessionAuthorityState,
  snapshot: SessionSnapshot,
  options: RendererSessionInstallationOptions
): boolean {
  const { operationId, sessionGeneration, transitionTarget } = options;
  const projectionStore = useSessionProjectionStore.getState();
  if (
    transitionTarget !== undefined
    && !projectionStore.acceptTransition(state, transitionTarget)
  ) return false;
  const current = projectionStore.authority;
  const currentSessionId = current.phase === "active" ? current.sessionId : undefined;
  const currentGeneration = current.phase === "active" ? current.sessionGeneration : undefined;
  const authorityChanged = currentSessionId !== snapshot.sessionId
    || (
      sessionGeneration !== undefined
      && currentGeneration !== undefined
      && sessionGeneration !== currentGeneration
    );
  const installation = projectionStore.beginSnapshotReplacement(
    state,
    snapshot,
    sessionGeneration,
    transitionTarget
  );
  if (!installation) return false;
  const stagedCatalog = matchingStagedExtensionCatalog({
    hostEpoch: installation.hostEpoch,
    projectionRevision: installation.baseProjectionRevision,
    sessionId: installation.sessionId,
    sessionGeneration: installation.sessionGeneration,
    operationId
  });
  const isCurrent = () => useSessionProjectionStore.getState()
    .isSnapshotReplacementCurrent(state, installation);

  if (authorityChanged) {
    useWorkspaceChangesStore.getState().reset("stale");
    if (!isCurrent()) return false;
    resetRendererSessionInteractiveState();
    if (!isCurrent()) return false;
    resetExtensionUiCatalogState();
    if (!isCurrent()) return false;
  }
  resetConversationRequests();
  const projectionAuthority = featureProjectionAuthorityFromInstallation(installation);
  if (!useConversationStore.getState().replaceSnapshot(snapshot, projectionAuthority)) return false;
  if (!isCurrent()) return false;
  if (!useSessionTreeStore.getState().replaceProjection(projectionAuthority, snapshot.tree)) return false;
  if (!isCurrent()) return false;
  useLiveTurnStore.getState().reset();
  if (!isCurrent()) return false;
  if (stagedCatalog) useExtensionUiStore.getState().installCatalog(projectionAuthority, stagedCatalog);
  if (!isCurrent()) return false;
  if (options.stageAdditionalProjections?.(installation, isCurrent) === false) return false;
  if (!isCurrent()) return false;
  return useSessionProjectionStore.getState().commitSnapshotReplacement(
    state,
    installation,
    snapshot
  ) !== undefined;
}
