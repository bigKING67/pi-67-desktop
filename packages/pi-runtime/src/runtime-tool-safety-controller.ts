import {
  DEFAULT_APPROVAL_MODE,
  DEFAULT_TASK_TOOL_MODE,
  MAX_APPROVAL_CWD_BYTES,
  MAX_TASK_TRUSTED_ROOTS,
  RuntimeError,
  type ApprovalMode,
  type ApprovalResolution,
  type ApprovalResponseDecision,
  type TaskToolMode,
  type WorkspaceTrust
} from "@pi67/domain";
import { isAbsolute } from "node:path";
import type { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import type { SafetyPolicyState } from "./safety-extension.js";

export class RuntimeToolSafetyController {
  private state: SafetyPolicyState = {
    cwd: process.cwd(),
    trust: "unknown",
    approvalMode: DEFAULT_APPROVAL_MODE,
    taskToolMode: DEFAULT_TASK_TOOL_MODE,
    taskTrustedRoots: []
  };

  get policy(): SafetyPolicyState { return this.state; }

  initialize(cwd: string, trust: WorkspaceTrust, approvalMode: ApprovalMode): void {
    this.state = {
      cwd,
      trust,
      approvalMode,
      taskToolMode: DEFAULT_TASK_TOOL_MODE,
      taskTrustedRoots: []
    };
  }

  setCwd(cwd: string): void { this.state = { ...this.state, cwd }; }

  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): TaskToolMode {
    this.state = {
      ...this.state,
      trust,
      approvalMode,
      ...(trust === "trusted"
        ? {}
        : { taskToolMode: DEFAULT_TASK_TOOL_MODE, taskTrustedRoots: [] })
    };
    return this.state.taskToolMode;
  }

  getTaskToolMode(): TaskToolMode { return this.state.taskToolMode; }

  resetTaskAuthorizations(): void {
    this.state = {
      ...this.state,
      taskToolMode: DEFAULT_TASK_TOOL_MODE,
      taskTrustedRoots: []
    };
  }

  setTaskToolMode(mode: TaskToolMode): TaskToolMode {
    if (mode === "ask") mode = DEFAULT_TASK_TOOL_MODE;
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
    if (decision === "trust-task-paths-and-allow" && this.state.trust !== "trusted") {
      return { resolved: false, taskToolMode: this.state.taskToolMode };
    }
    if (
      decision === "trust-task-paths-and-allow"
      && bridge.hasPendingHardStopApproval(requestId, toolCallId)
    ) {
      return { resolved: false, taskToolMode: this.state.taskToolMode };
    }
    if (decision === "trust-task-paths-and-allow") {
      const paths = bridge.pendingTaskPathGrant(requestId, toolCallId);
      if (!paths || !this.addTaskTrustedRoots(paths)) {
        return { resolved: false, taskToolMode: this.state.taskToolMode };
      }
    }
    if (decision === "enable-task-yolo-and-allow") this.setTaskToolMode("yolo");
    const resolved = bridge.resolveApproval(requestId, toolCallId, decision);
    if (resolved && decision === "enable-task-yolo-and-allow") bridge.allowAllPendingApprovals();
    return { resolved, taskToolMode: this.state.taskToolMode };
  }

  private addTaskTrustedRoots(paths: readonly string[]): boolean {
    if (paths.length === 0) return false;
    const current = this.state.taskTrustedRoots ?? [];
    const next = new Set(current);
    for (const path of paths) {
      if (!isAbsolute(path) || Buffer.byteLength(path, "utf8") > MAX_APPROVAL_CWD_BYTES) return false;
      next.add(path);
    }
    if (next.size > MAX_TASK_TRUSTED_ROOTS) return false;
    this.state = { ...this.state, taskTrustedRoots: [...next] };
    return true;
  }
}
