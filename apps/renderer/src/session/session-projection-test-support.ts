import type { SessionSnapshot } from "@pi67/domain";
import {
  useSessionProjectionStore,
  type SessionProjectionAuthority,
  type SessionProjectionConnection,
  type SessionProjectionTransitionTarget
} from "./session-projection-store.js";

export function sessionSnapshotFixture(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  const sessionId = overrides.sessionId ?? "session-1";
  return {
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: [],
    ...overrides,
    sessionId,
    sessionFileIdentity: overrides.sessionFileIdentity ?? `session-file-${sessionId}`
  };
}

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
