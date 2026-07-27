import type {
  ResourceSummary,
  SessionControlsView,
  SessionModelCatalogView,
  SessionResourceCatalogResult
} from "@pi67/domain";
import type { SessionProjectionAuthorityState } from "./session-projection-authority.js";
import {
  canApplySessionProjectionTarget,
  type SessionProjectionRevisions,
  type SessionProjectionTarget
} from "./session-projection-revisions.js";

export interface ResourceCatalogProjectionPatch {
  controls?: SessionControlsView;
  modelCatalog?: SessionModelCatalogView;
  resources?: ResourceSummary[];
  revisions: SessionProjectionRevisions;
}

export function resourceCatalogProjectionPatch(
  authority: SessionProjectionAuthorityState,
  revisions: SessionProjectionRevisions,
  target: SessionProjectionTarget,
  result: SessionResourceCatalogResult
): ResourceCatalogProjectionPatch | undefined {
  if (!canApplySessionProjectionTarget(authority, target, result.sessionId)) return undefined;

  const patch: Omit<ResourceCatalogProjectionPatch, "revisions"> = {};
  const nextRevisions = { ...revisions };
  if (revisions.modelCatalog === target.revisions.modelCatalog) {
    patch.modelCatalog = result.modelCatalog;
    nextRevisions.modelCatalog += 1;
  }
  if (revisions.controls === target.revisions.controls) {
    patch.controls = result.controls;
    nextRevisions.controls += 1;
  }
  if (revisions.resources === target.revisions.resources) {
    patch.resources = result.resources;
    nextRevisions.resources += 1;
  }
  if (Object.keys(patch).length === 0) return undefined;
  return { ...patch, revisions: nextRevisions };
}
