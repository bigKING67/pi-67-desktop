import type { OperationView } from "@pi67/domain";
import type { EventEnvelope } from "@pi67/protocol";
import {
  currentRendererSessionAuthority,
  type RendererSessionAuthorityState
} from "../session/session-authority.js";

export interface InteractiveAuthority {
  hostEpoch?: number;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

export interface InteractiveAuthorityState extends RendererSessionAuthorityState {
  operation: OperationView | undefined;
}

export function hasCurrentInteractiveAuthority(
  state: InteractiveAuthorityState,
  request: InteractiveAuthority
): boolean {
  const authority = currentRendererSessionAuthority(state);
  return authority !== undefined
    && request.hostEpoch !== undefined
    && request.sessionId !== undefined
    && request.sessionGeneration !== undefined
    && request.hostEpoch === authority.hostEpoch
    && request.sessionId === authority.sessionId
    && request.sessionGeneration === authority.sessionGeneration
    && request.operationId === activeOperationId(state.operation);
}

export function matchesInteractiveEnvelope(
  request: InteractiveAuthority,
  envelope: EventEnvelope
): boolean {
  return request.hostEpoch !== undefined
    && request.sessionId !== undefined
    && request.sessionGeneration !== undefined
    && request.hostEpoch === envelope.hostEpoch
    && request.sessionId === envelope.sessionId
    && request.sessionGeneration === envelope.sessionGeneration
    && request.operationId === envelope.operationId;
}

function activeOperationId(operation: OperationView | undefined): string | undefined {
  if (
    operation?.lifecycle === "accepted"
    || operation?.lifecycle === "running"
    || operation?.lifecycle === "waiting-input"
  ) return operation.operationId;
  return undefined;
}
