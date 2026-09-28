import { useEffect, useRef } from "react";
import { refreshWorkspaceChanges } from "../changes/workspace-changes-controller.js";
import {
  selectCommittedWorkspaceChangesProjection,
  useWorkspaceChangesStore
} from "../changes/workspace-changes-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";

/**
 * Reads the `会话修改` projection once per projection revision so settled answers can list the
 * files their turn changed. Silent: the Changes Inspector owns loading and error reporting.
 */
export function useTurnChangesRefresh(enabled: boolean): void {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  const view = useWorkspaceChangesStore((state) => (
    selectCommittedWorkspaceChangesProjection(state, canonicalAuthority)
  ));
  const requestedAuthority = useRef<string | undefined>(undefined);
  const authorityKey = view.authority
    ? `${view.authority.hostEpoch}:${view.authority.sessionId}:${view.authority.sessionGeneration}:${view.authority.projectionRevision}`
    : undefined;

  useEffect(() => {
    if (!enabled || !authorityKey || view.status !== "stale") return;
    if (requestedAuthority.current === authorityKey) return;
    requestedAuthority.current = authorityKey;
    void refreshWorkspaceChanges({ silent: true });
  }, [authorityKey, enabled, view.status]);
}
