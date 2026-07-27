import type {
  EventEnvelope,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import {
  useSessionProjectionStore,
  type SessionProjectionAuthority,
  type SessionProjectionConnection,
  type SessionProjectionTransitionTarget
} from "./session-projection-store.js";

export type RendererSessionAuthority = SessionProjectionAuthority;
export type RendererSessionAuthorityState = SessionProjectionConnection;
export type RendererSessionTransitionTarget = SessionProjectionTransitionTarget;

export type RendererSessionBootstrapDisposition =
  | "committed"
  | "missing-bootstrap"
  | "stale";

export function currentRendererSessionAuthority(
  state: RendererSessionAuthorityState
): RendererSessionAuthority | undefined {
  return useSessionProjectionStore.getState().currentAuthority(state);
}

export function acceptRendererSessionEvent(
  state: RendererSessionAuthorityState,
  envelope: EventEnvelope,
  payloadSessionId?: string
): RendererSessionAuthority | undefined {
  return useSessionProjectionStore.getState().acceptEvent(state, envelope, payloadSessionId);
}

export function acceptRendererSessionResponse(
  state: RendererSessionAuthorityState,
  target: RendererSessionAuthority
): boolean {
  return useSessionProjectionStore.getState().acceptResponse(state, target);
}

export function captureRendererSessionTransition(
  state: RendererSessionAuthorityState
): RendererSessionTransitionTarget | undefined {
  return useSessionProjectionStore.getState().captureTransition(state);
}

export function acceptRendererSessionTransitionResponse(
  state: RendererSessionAuthorityState,
  target: RendererSessionTransitionTarget
): boolean {
  return useSessionProjectionStore.getState().acceptTransition(state, target);
}

export function classifyRendererSessionBootstrap(
  state: RendererSessionAuthorityState,
  target: RendererSessionTransitionTarget,
  acknowledgement?: ProjectionMutationAcknowledgement
): RendererSessionBootstrapDisposition {
  if (acceptRendererSessionTransitionResponse(state, target)) return "missing-bootstrap";
  const authority = currentRendererSessionAuthority(state);
  if (!authority || authority.hostEpoch !== target.hostEpoch) return "stale";
  if (
    acknowledgement
    && (
      acknowledgement.hostEpoch !== authority.hostEpoch
      || acknowledgement.sessionId !== authority.sessionId
      || acknowledgement.sessionGeneration !== authority.sessionGeneration
    )
  ) return "stale";
  return "committed";
}
