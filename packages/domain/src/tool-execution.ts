import type {
  ToolAuthorizationProjection,
  ToolPresentationKind
} from "./operation.js";

export const MAX_TOOL_CALL_ID_CHARS = 512;
export const MAX_TOOL_NAME_CHARS = 128;
export const MAX_TOOL_INPUT_SUMMARY_CHARS = 2_000;
export const MAX_TOOL_COMMAND_CHARS = 2_000;
export const MAX_TOOL_CWD_CHARS = 1_024;
export const MAX_TOOL_PROGRESS_CHARS = 4_096;
export const MAX_TOOL_FAILURE_CHARS = 4_096;
export const MAX_OPERATION_TOOL_EXECUTIONS = 64;
export const MAX_TOOL_EXECUTION_RECEIPT_ITEMS = 512;

export type ToolExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "lost"
  | "unreconciled";

export interface BoundedToolText {
  text: string;
  truncated: boolean;
}

export interface ToolExecutionFailureView {
  detailState: "available" | "missing";
  source: "pi-result" | "runtime-event" | "projection-integrity";
  message?: BoundedToolText;
}

export interface ToolExecutionView {
  toolCallId: string;
  toolName: string;
  toolKind: ToolPresentationKind;
  status: ToolExecutionStatus;
  projectionSource: "live" | "durable" | "recovered";
  inputSummary?: BoundedToolText;
  command?: BoundedToolText;
  cwd?: string;
  progress?: BoundedToolText;
  resultState: "pending" | "present" | "unreconciled";
  failure?: ToolExecutionFailureView;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  timingSource?: "runtime" | "receipt";
  aliasTarget?: string;
  authorization?: ToolAuthorizationProjection;
}

export function isUnsuccessfulToolStatus(status: ToolExecutionStatus): boolean {
  return status === "failed"
    || status === "interrupted"
    || status === "cancelled"
    || status === "lost"
    || status === "unreconciled";
}
