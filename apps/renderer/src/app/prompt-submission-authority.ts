import type { OperationSubmissionResult } from "@pi67/protocol";
import {
  currentRendererSessionAuthority,
  type RendererSessionAuthority,
  type RendererSessionAuthorityState
} from "../session/session-authority.js";

export type PromptSubmissionAuthority = RendererSessionAuthority;

export type PromptSubmissionAuthorityIssue =
  | "AUTHORITY_NOT_READY"
  | "STALE_HOST_EPOCH"
  | "STALE_SESSION_GENERATION"
  | "STALE_PROJECTION";

export function capturePromptSubmissionAuthority(
  source: RendererSessionAuthorityState
): PromptSubmissionAuthority | undefined {
  return currentRendererSessionAuthority(source);
}

export function validatePromptSubmissionAcceptance(
  expected: PromptSubmissionAuthority,
  accepted: OperationSubmissionResult,
  current: RendererSessionAuthorityState
): PromptSubmissionAuthorityIssue | undefined {
  const currentAuthority = currentRendererSessionAuthority(current);
  if (
    accepted.hostEpoch !== expected.hostEpoch
    || current.hostEpoch !== expected.hostEpoch
  ) return "STALE_HOST_EPOCH";
  if (
    accepted.sessionId !== expected.sessionId
    || accepted.sessionGeneration !== expected.sessionGeneration
    || currentAuthority === undefined
    || currentAuthority.sessionId !== expected.sessionId
    || currentAuthority.sessionGeneration !== expected.sessionGeneration
  ) return "STALE_SESSION_GENERATION";
  if (currentAuthority.projectionRevision !== expected.projectionRevision) return "STALE_PROJECTION";
  return undefined;
}

export function promptSubmissionAuthorityMessage(issue: PromptSubmissionAuthorityIssue): string {
  switch (issue) {
    case "AUTHORITY_NOT_READY":
      return "Pi 会话身份尚未就绪，消息未发送";
    case "STALE_HOST_EPOCH":
      return "Agent Host 已在发送期间替换，旧确认已忽略";
    case "STALE_SESSION_GENERATION":
      return "发送期间 Pi 会话已切换，旧确认已忽略";
    case "STALE_PROJECTION":
      return "发送期间 Pi 会话已重新同步，旧确认已忽略";
  }
}
