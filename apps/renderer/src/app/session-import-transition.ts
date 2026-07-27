import {
  isOperationSettled,
  type OperationSubmissionResult
} from "@pi67/protocol";
import {
  acceptRendererSessionResponse,
  acceptRendererSessionTransitionResponse,
  captureRendererSessionTransition,
  currentRendererSessionAuthority,
  type RendererSessionAuthority,
  type RendererSessionAuthorityState,
  type RendererSessionTransitionTarget
} from "../session/session-authority.js";

export interface SessionImportSubmissionTarget {
  authority: RendererSessionAuthority;
  transition: RendererSessionTransitionTarget;
}

export type SessionImportResponseDisposition =
  | "accepted"
  | "terminal"
  | "bootstrap-required"
  | "stale";

export function captureSessionImportSubmission(
  state: RendererSessionAuthorityState
): SessionImportSubmissionTarget | undefined {
  const authority = currentRendererSessionAuthority(state);
  const transition = captureRendererSessionTransition(state);
  return authority && transition && authority.hostEpoch === transition.hostEpoch
    ? { authority, transition }
    : undefined;
}

export function classifySessionImportResponse(
  state: RendererSessionAuthorityState,
  target: SessionImportSubmissionTarget,
  result: OperationSubmissionResult
): SessionImportResponseDisposition {
  if (!isSessionImportSubmissionCurrent(state, target)) return "stale";
  if (result.hostEpoch !== target.authority.hostEpoch) return "stale";

  if (!isOperationSettled(result)) {
    return result.sessionId === target.authority.sessionId
      && result.sessionGeneration === target.authority.sessionGeneration
      ? "accepted"
      : "stale";
  }
  if (result.operationKind !== "session-import") return "stale";
  if (result.lifecycle === "completed") return "bootstrap-required";
  return result.sessionId === target.authority.sessionId
    && result.sessionGeneration === target.authority.sessionGeneration
    ? "terminal"
    : "bootstrap-required";
}

export function isSessionImportSubmissionCurrent(
  state: RendererSessionAuthorityState,
  target: SessionImportSubmissionTarget
): boolean {
  return acceptRendererSessionTransitionResponse(state, target.transition)
    && acceptRendererSessionResponse(state, target.authority);
}
