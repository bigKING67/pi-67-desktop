import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type { SubmissionAuthority } from "./operation-submission-ledger.js";
import { HostCommandError } from "./protocol-error.js";

export function assertCurrentOperationAuthority(
  current: RuntimeIdentity,
  expected: SubmissionAuthority
): void {
  if (
    current.sessionId === expected.sessionId
    && current.sessionGeneration === expected.sessionGeneration
  ) return;
  throw staleGeneration(
    "The submission belongs to a stale Pi session generation.",
    current.sessionGeneration,
    expected.sessionGeneration
  );
}

export function assertOperationAuthority(
  expected: SubmissionAuthority,
  operation: OperationView
): void {
  if (
    operation.sessionId === expected.sessionId
    && operation.sessionGeneration === expected.sessionGeneration
  ) return;
  throw staleGeneration(
    "The active operation belongs to a stale Pi session generation.",
    expected.sessionGeneration,
    operation.sessionGeneration
  );
}

function staleGeneration(
  message: string,
  expectedSessionGeneration: number,
  receivedSessionGeneration: number
): HostCommandError {
  return new HostCommandError("STALE_SESSION_GENERATION", message, true, {
    expectedSessionGeneration,
    receivedSessionGeneration
  });
}
