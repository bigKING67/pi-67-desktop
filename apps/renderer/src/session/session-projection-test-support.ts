import type { SessionSnapshot } from "@pi67/domain";
import {
  useSessionProjectionStore,
  type SessionProjectionAuthority,
  type SessionProjectionConnection,
  type SessionProjectionTransitionTarget
} from "./session-projection-store.js";

export function installSessionProjectionFixture(
  connection: SessionProjectionConnection,
  snapshot: SessionSnapshot,
  sessionGeneration?: number,
  transitionTarget?: SessionProjectionTransitionTarget
): SessionProjectionAuthority | undefined {
  const installation = useSessionProjectionStore.getState().beginSnapshotReplacement(
    connection,
    snapshot,
    sessionGeneration,
    transitionTarget
  );
  return installation
    ? useSessionProjectionStore.getState().commitSnapshotReplacement(
      connection,
      installation,
      snapshot
    )
    : undefined;
}
