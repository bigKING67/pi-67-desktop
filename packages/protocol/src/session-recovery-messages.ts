import type { SessionRecoveryView } from "@pi67/domain";
import type { OperationSubmissionResult } from "./operation-messages.js";

export interface SessionRecoveryCommandPayloads {
  "session.recovery.inspect": Record<string, never>;
  "session.recovery.continue": { submissionId: string; anchor: string };
}

export interface SessionRecoveryCommandResults {
  "session.recovery.inspect": SessionRecoveryView;
  "session.recovery.continue": OperationSubmissionResult;
}
