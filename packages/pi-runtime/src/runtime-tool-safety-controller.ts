import {
  DEFAULT_APPROVAL_MODE,
  DEFAULT_TASK_TOOL_MODE,
  RuntimeError,
  type ApprovalMode,
  type ApprovalResolution,
  type ApprovalResponseDecision,
  type TaskToolMode,
  type WorkspaceTrust
} from "@pi67/domain";
import type { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import type { SafetyPolicyState } from "./safety-extension.js";

export class RuntimeToolSafetyController {
  private state: SafetyPolicyState = {
    cwd: process.cwd(),
    trust: "unknown",
    approvalMode: DEFAULT_APPROVAL_MODE,
    taskToolMode: DEFAULT_TASK_TOOL_MODE
  };

  get policy(): SafetyPolicyState { return this.state; }

  initialize(cwd: string, trust: WorkspaceTrust, approvalMode: ApprovalMode): void {
    this.state = {
      cwd,
      trust,
      approvalMode,
      taskToolMode: approvalMode === "guided" ? "ask" : DEFAULT_TASK_TOOL_MODE
    };
  }

  setCwd(cwd: string): void { this.state = { ...this.state, cwd }; }

  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): TaskToolMode {
    this.state = {
      ...this.state,
      trust,
      approvalMode,
      ...(trust === "trusted" ? {} : { taskToolMode: DEFAULT_TASK_TOOL_MODE })
    };
    return this.state.taskToolMode;
  }

  getTaskToolMode(): TaskToolMode { return this.state.taskToolMode; }

  setTaskToolMode(mode: TaskToolMode): TaskToolMode {
    if (mode === "yolo" && this.state.trust !== "trusted") {
      throw new RuntimeError(
        "WORKSPACE_NOT_TRUSTED",
        "YOLO requires a trusted Workspace."
      );
    }
    this.state = { ...this.state, taskToolMode: mode };
    return this.state.taskToolMode;
  }

  resolveApproval(
    bridge: DesktopExtensionUiBridge,
    requestId: string,
    toolCallId: string,
    decision: ApprovalResponseDecision
  ): ApprovalResolution {
    if (!bridge.hasPendingApproval(requestId, toolCallId)) {
      return { resolved: false, taskToolMode: this.state.taskToolMode };
    }
    if (decision === "enable-task-yolo-and-allow" && this.state.trust !== "trusted") {
      return { resolved: false, taskToolMode: this.state.taskToolMode };
    }
    if (decision === "enable-task-yolo-and-allow") this.setTaskToolMode("yolo");
    const resolved = bridge.resolveApproval(requestId, toolCallId, decision);
    if (resolved && decision === "enable-task-yolo-and-allow") bridge.allowAllPendingApprovals();
    return { resolved, taskToolMode: this.state.taskToolMode };
  }
}
