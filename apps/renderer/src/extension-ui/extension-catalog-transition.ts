import type { ExtensionCatalogResult, OperationView } from "@pi67/domain";
import type { EventEnvelope } from "@pi67/protocol";
import { eventSessionAuthority } from "../connection/event-authority.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import type { RendererSessionAuthorityState } from "../session/session-authority.js";
import { useExtensionUiStore } from "./extension-ui-store.js";

export function stageRendererSessionExtensionCatalog(
  state: RendererSessionAuthorityState & { operation: OperationView | undefined },
  envelope: EventEnvelope,
  catalog: ExtensionCatalogResult
): boolean {
  const eventAuthority = eventSessionAuthority(envelope);
  const authority = useSessionProjectionStore.getState().authority;
  const importOperation = activeSessionImportOperation(state.operation, eventAuthority?.operationId);
  if (
    !state.connected
    || (authority.phase === "active" && !importOperation)
    || state.hostEpoch === undefined
    || envelope.hostEpoch !== state.hostEpoch
    || eventAuthority === undefined
  ) return false;
  useExtensionUiStore.getState().stageCatalog({
    hostEpoch: envelope.hostEpoch,
    sessionId: eventAuthority.sessionId,
    sessionGeneration: eventAuthority.sessionGeneration,
    projectionRevision: authority.projectionRevision,
    ...(eventAuthority.operationId === undefined ? {} : { operationId: eventAuthority.operationId }),
    catalog
  });
  return true;
}

export function matchingStagedExtensionCatalog(target: {
  hostEpoch: number | undefined;
  projectionRevision: number;
  sessionId: string;
  sessionGeneration: number | undefined;
  operationId: string | undefined;
}): ExtensionCatalogResult | undefined {
  if (target.hostEpoch === undefined || target.sessionGeneration === undefined) return undefined;
  const staged = useExtensionUiStore.getState().stagedCatalog;
  return staged
    && staged.hostEpoch === target.hostEpoch
    && staged.sessionId === target.sessionId
    && staged.sessionGeneration === target.sessionGeneration
    && staged.projectionRevision === target.projectionRevision
    && staged.operationId === target.operationId
      ? staged.catalog
      : undefined;
}

function activeSessionImportOperation(
  operation: OperationView | undefined,
  operationId: string | undefined
): boolean {
  return operation?.kind === "session-import"
    && operation.operationId === operationId
    && (
      operation.lifecycle === "accepted"
      || operation.lifecycle === "running"
      || operation.lifecycle === "waiting-input"
    );
}
