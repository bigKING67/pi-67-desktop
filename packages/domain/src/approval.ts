import type { RiskCategory } from "./safety-policy.js";
import type { TaskToolMode } from "./runtime-state.js";
import type { NativeSubagentLineage } from "./native-subagent.js";

export type ApprovalTargetKind = "command" | "path" | "tool";
export type ApprovalResponseDecision =
  | "deny"
  | "allow-once"
  | "trust-task-paths-and-allow"
  | "enable-task-yolo-and-allow";

export interface ApprovalTaskPathGrant {
  kind: "paths";
  paths: string[];
}

export interface ApprovalResolution {
  resolved: boolean;
  taskToolMode: TaskToolMode;
}

export interface ApprovalRequestDetails {
  toolCallId: string;
  toolName: string;
  toolSource: string;
  category: RiskCategory;
  reason: string;
  targetKind: ApprovalTargetKind;
  target: string;
  targetTruncated: boolean;
  cwd: string;
  cwdTruncated: boolean;
  scope: "single-tool-call";
  taskPathGrant?: ApprovalTaskPathGrant;
  subagent?: NativeSubagentLineage;
}

export interface ApprovalRequestView extends ApprovalRequestDetails {
  requestId: string;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
  hostEpoch?: number;
}
