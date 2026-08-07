import type { RuntimeIdentity } from "@pi67/domain";
import type { OperationSettled, OperationSubmissionResult } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export interface SubmissionAuthority {
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
}

interface SubmissionRecord {
  fingerprint: string;
  result: OperationSubmissionResult;
  authority: SubmissionAuthority;
}

interface PendingSubmission {
  fingerprint: string;
  result: Promise<OperationSubmissionResult>;
  authority: SubmissionAuthority;
}

export class OperationSubmissionLedger {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly pendingSubmissions = new Map<string, PendingSubmission>();

  constructor(
    private readonly maxSubmissions: number,
    private readonly getIdentity: () => RuntimeIdentity
  ) {}

  get(
    submissionId: string,
    fingerprint: string
  ): OperationSubmissionResult | Promise<OperationSubmissionResult> | undefined {
    const completed = this.submissions.get(submissionId);
    if (completed) {
      this.assertFingerprint(submissionId, completed.fingerprint, fingerprint);
      this.assertCurrentAuthority(completed.authority);
      return completed.result;
    }
    const pending = this.pendingSubmissions.get(submissionId);
    if (!pending) return undefined;
    this.assertFingerprint(submissionId, pending.fingerprint, fingerprint);
    this.assertCurrentAuthority(pending.authority);
    return pending.result;
  }

  remember(
    submissionId: string,
    fingerprint: string,
    result: OperationSubmissionResult,
    authority: SubmissionAuthority
  ): OperationSubmissionResult {
    this.submissions.set(submissionId, { fingerprint, result, authority });
    while (this.submissions.size > this.maxSubmissions) {
      const oldest = this.submissions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.submissions.delete(oldest);
    }
    return result;
  }

  rememberPending(
    submissionId: string,
    fingerprint: string,
    result: Promise<OperationSubmissionResult>,
    authority: SubmissionAuthority
  ): void {
    this.pendingSubmissions.set(submissionId, { fingerprint, result, authority });
  }

  deletePending(submissionId: string): void {
    this.pendingSubmissions.delete(submissionId);
  }

  updateTerminal(terminal: OperationSettled): void {
    const authority = authorityFromTerminal(terminal);
    for (const record of this.submissions.values()) {
      if (record.result.operationId !== terminal.operationId) continue;
      record.result = terminal;
      record.authority = authority;
    }
  }

  private assertFingerprint(submissionId: string, expected: string, received: string): void {
    if (expected === received) return;
    throw new HostCommandError(
      "DUPLICATE_REQUEST",
      "A submission ID cannot be reused with different operation content.",
      false,
      { submissionId }
    );
  }

  private assertCurrentAuthority(authority: SubmissionAuthority): void {
    assertCurrentSubmissionAuthority(this.getIdentity(), authority);
  }
}

export function assertCurrentSubmissionAuthority(
  current: RuntimeIdentity,
  authority: SubmissionAuthority
): void {
  if (
    current.sessionId !== authority.sessionId
    || current.sessionFileIdentity !== authority.sessionFileIdentity
  ) {
    throw new HostCommandError(
      "STALE_SESSION_IDENTITY",
      "The submission belongs to a different physical Pi Session.",
      true,
      {
        sessionIdMatches: current.sessionId === authority.sessionId,
        sessionFileIdentityMatches:
          current.sessionFileIdentity === authority.sessionFileIdentity
      }
    );
  }
  if (current.sessionGeneration === authority.sessionGeneration) return;
  throw new HostCommandError(
    "STALE_SESSION_GENERATION",
    "The submission belongs to a stale Pi session generation.",
    true,
    {
      expectedSessionGeneration: current.sessionGeneration,
      receivedSessionGeneration: authority.sessionGeneration
    }
  );
}

export function authorityFromIdentity(
  identity: RuntimeIdentity & { sessionId: string; sessionFileIdentity: string }
): SubmissionAuthority {
  return {
    sessionId: identity.sessionId,
    sessionFileIdentity: identity.sessionFileIdentity,
    sessionGeneration: identity.sessionGeneration
  };
}

function authorityFromTerminal(terminal: OperationSettled): SubmissionAuthority {
  return {
    sessionId: terminal.sessionId,
    sessionFileIdentity: terminal.sessionFileIdentity,
    sessionGeneration: terminal.sessionGeneration
  };
}
