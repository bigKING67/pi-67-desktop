import type {
  ActiveProposedPlan,
  SessionControlResult,
  SessionModelCatalogResult,
  SessionResourceCatalogResult,
  SessionSnapshot,
  SessionInteractionMode
} from "@pi67/domain";
import {
  activeSessionProjectionAuthorityWithoutConnection,
  matchesSessionProjectionAuthority,
  type SessionProjectionAuthority
} from "./session-projection-authority.js";
import { resourceCatalogProjectionPatch } from "./session-projection-results.js";
import {
  canApplySessionProjectionTarget,
  incrementSessionProjectionRevision,
  type SessionProjectionGroup,
  type SessionProjectionTarget
} from "./session-projection-revisions.js";
import {
  controlProjectionFromSnapshot,
  identityProjectionFromSnapshot,
  interactionProjectionFromSnapshot,
  modelCatalogProjectionFromSnapshot,
  queueProjectionFromSnapshot,
  type SessionQueueProjection
} from "./session-projection-snapshot.js";
import type {
  SessionMetaUpdate,
  SessionProjectionData,
  SessionUsageUpdate
} from "./session-projection-state.js";

export function sessionSnapshotProjectionPatch(
  state: SessionProjectionData,
  target: SessionProjectionTarget,
  snapshot: SessionSnapshot,
  groups: readonly SessionProjectionGroup[]
): Partial<SessionProjectionData> | undefined {
  if (
    snapshot.sessionId !== target.sessionId
    || !matchesSessionProjectionAuthority(
      activeSessionProjectionAuthorityWithoutConnection(state.authority),
      target
    )
  ) return undefined;

  const patch: Partial<SessionProjectionData> = {};
  const revisions = { ...state.revisions };
  let applied = false;
  for (const group of groups) {
    if (state.revisions[group] !== target.revisions[group]) continue;
    applied = true;
    revisions[group] += 1;
    if (group === "identity") {
      patch.identity = identityProjectionFromSnapshot(snapshot);
      patch.compatibility = snapshot.compatibility;
      patch.recoverySessionFileIdentity = snapshot.sessionFileIdentity;
      patch.recoverySessionPath = snapshot.sessionPath;
    } else if (group === "modelCatalog") {
      patch.modelCatalog = modelCatalogProjectionFromSnapshot(snapshot);
    } else if (group === "controls") {
      patch.controls = controlProjectionFromSnapshot(snapshot);
    } else if (group === "interaction") {
      patch.interaction = interactionProjectionFromSnapshot(snapshot);
    } else if (group === "queue") {
      patch.queue = queueProjectionFromSnapshot(snapshot);
    } else if (group === "resources") {
      patch.resources = snapshot.resources;
    } else {
      patch.usage = snapshot.stats;
    }
  }
  return applied ? { ...patch, revisions } : undefined;
}

export function sessionControlResultPatch(
  state: SessionProjectionData,
  target: SessionProjectionTarget,
  result: SessionControlResult
): Partial<SessionProjectionData> | undefined {
  if (
    !canApplySessionProjectionTarget(state.authority, target, result.sessionId)
    || state.revisions.controls !== target.revisions.controls
  ) return undefined;
  return {
    controls: result.controls,
    revisions: incrementSessionProjectionRevision(state.revisions, "controls")
  };
}

export function sessionModelCatalogResultPatch(
  state: SessionProjectionData,
  target: SessionProjectionTarget,
  result: SessionModelCatalogResult
): Partial<SessionProjectionData> | undefined {
  if (!canApplySessionProjectionTarget(state.authority, target, result.sessionId)) return undefined;
  const patch: Partial<SessionProjectionData> = {};
  const revisions = { ...state.revisions };
  let applied = false;
  if (state.revisions.modelCatalog === target.revisions.modelCatalog) {
    patch.modelCatalog = result.modelCatalog;
    revisions.modelCatalog += 1;
    applied = true;
  }
  if (state.revisions.controls === target.revisions.controls) {
    patch.controls = result.controls;
    revisions.controls += 1;
    applied = true;
  }
  return applied ? { ...patch, revisions } : undefined;
}

export function sessionResourceCatalogResultPatch(
  state: SessionProjectionData,
  target: SessionProjectionTarget,
  result: SessionResourceCatalogResult
): Partial<SessionProjectionData> | undefined {
  return resourceCatalogProjectionPatch(
    state.authority,
    state.revisions,
    target,
    result
  );
}

export function sessionQueueProjectionPatch(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority,
  queue: SessionQueueProjection
): Partial<SessionProjectionData> | undefined {
  if (!matchesCurrentAuthority(state, authority)) return undefined;
  return {
    queue,
    revisions: incrementSessionProjectionRevision(state.revisions, "queue")
  };
}

export function sessionMetaProjectionPatch(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority,
  update: SessionMetaUpdate
): Partial<SessionProjectionData> | undefined {
  if (!matchesCurrentAuthority(state, authority) || !state.identity || !state.controls) return undefined;
  return {
    identity: { ...state.identity, sessionName: update.sessionName },
    controls: {
      ...(update.selectedModel === undefined ? {} : { selectedModel: update.selectedModel }),
      thinkingLevel: update.thinkingLevel
    },
    revisions: incrementSessionProjectionRevision(
      incrementSessionProjectionRevision(state.revisions, "identity"),
      "controls"
    )
  };
}

export function sessionUsageProjectionPatch(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority,
  update: SessionUsageUpdate
): Partial<SessionProjectionData> | undefined {
  if (!matchesCurrentAuthority(state, authority)) return undefined;
  return {
    usage: update,
    revisions: incrementSessionProjectionRevision(state.revisions, "usage")
  };
}

export function sessionInteractionModeProjectionPatch(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority,
  interactionMode: SessionInteractionMode
): Partial<SessionProjectionData> | undefined {
  if (!matchesCurrentAuthority(state, authority)) return undefined;
  return {
    interaction: {
      interactionMode,
      ...(interactionMode === "plan" && state.interaction?.activeProposedPlan
        ? { activeProposedPlan: state.interaction.activeProposedPlan }
        : {})
    },
    revisions: incrementSessionProjectionRevision(state.revisions, "interaction")
  };
}

export function proposedPlanProjectionPatch(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority,
  activeProposedPlan: ActiveProposedPlan
): Partial<SessionProjectionData> | undefined {
  if (!matchesCurrentAuthority(state, authority)) return undefined;
  return {
    interaction: { interactionMode: "plan", activeProposedPlan },
    revisions: incrementSessionProjectionRevision(state.revisions, "interaction")
  };
}

export function clearedSessionQueuePatch(
  state: SessionProjectionData,
  target: SessionProjectionTarget
): Partial<SessionProjectionData> | undefined {
  if (
    !matchesCurrentAuthority(state, target)
    || state.revisions.queue !== target.revisions.queue
  ) return undefined;
  return {
    queue: { steeringQueue: [], followUpQueue: [] },
    revisions: incrementSessionProjectionRevision(state.revisions, "queue")
  };
}

function matchesCurrentAuthority(
  state: SessionProjectionData,
  authority: SessionProjectionAuthority
): boolean {
  return matchesSessionProjectionAuthority(
    activeSessionProjectionAuthorityWithoutConnection(state.authority),
    authority
  );
}
