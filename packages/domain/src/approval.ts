import type { RiskCategory } from "./safety-policy.js";

export type ApprovalTargetKind = "command" | "path" | "tool";

export interface ApprovalRequestDetails {
  toolCallId: string;
  toolName: string;
  category: RiskCategory;
  reason: string;
  targetKind: ApprovalTargetKind;
  target: string;
  targetTruncated: boolean;
  cwd: string;
  cwdTruncated: boolean;
  scope: "single-tool-call";
}

export interface ApprovalRequestView extends ApprovalRequestDetails {
  requestId: string;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
  hostEpoch?: number;
}
