import type { OperationView } from "@pi67/domain";
import type { EventEnvelope } from "@pi67/protocol";
import {
  currentRendererSessionAuthority,
  type RendererSessionAuthorityState
} from "../session/session-authority.js";
import { eventSessionAuthority } from "./event-authority.js";

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
  return hasCurrentInteractiveSessionAuthority(state, request)
    && request.operationId === activeOperationId(state.operation);
}

export function hasCurrentInteractiveSessionAuthority(
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
    && request.sessionGeneration === authority.sessionGeneration;
}

export function matchesInteractiveEnvelope(
  request: InteractiveAuthority,
  envelope: EventEnvelope
): boolean {
  const authority = eventSessionAuthority(envelope);
  return request.hostEpoch !== undefined
    && request.sessionId !== undefined
    && request.sessionGeneration !== undefined
    && authority !== undefined
    && request.hostEpoch === envelope.hostEpoch
    && request.sessionId === authority.sessionId
    && request.sessionGeneration === authority.sessionGeneration
    && request.operationId === authority.operationId;
}

function activeOperationId(operation: OperationView | undefined): string | undefined {
  if (
    operation?.lifecycle === "accepted"
    || operation?.lifecycle === "running"
    || operation?.lifecycle === "waiting-input"
  ) return operation.operationId;
  return undefined;
}
