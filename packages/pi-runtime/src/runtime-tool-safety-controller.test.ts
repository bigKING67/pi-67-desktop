import type { ApprovalRequestDetails } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";

describe("RuntimeToolSafetyController", () => {
  it("normalizes legacy ASK inputs to AUTO", () => {
    const controller = new RuntimeToolSafetyController();
    controller.initialize("/workspace", "trusted", "guided");

    expect(controller.getTaskToolMode()).toBe("auto");
    expect(controller.setTaskToolMode("ask")).toBe("auto");
  });

  it("keeps exact task path grants in memory and clears them when trust is revoked", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new RuntimeToolSafetyController();
    controller.initialize("/workspace", "trusted", "balanced");
    const pending = bridge.requestApproval({
      ...approvalDetails("external", "external-path"),
      target: "ls /external/project",
      taskPathGrant: { kind: "paths", paths: ["/external/project"] }
    });
    const request = events.find((event) => event.type === "approval.requested");
    if (request?.type !== "approval.requested") throw new Error("Expected path approval request.");

    expect(controller.resolveApproval(
      bridge,
      request.payload.requestId,
      request.payload.toolCallId,
      "trust-task-paths-and-allow"
    )).toEqual({ resolved: true, taskToolMode: "auto" });
    await expect(pending).resolves.toEqual({ status: "allowed" });
    expect(controller.policy.taskTrustedRoots).toEqual(["/external/project"]);

    expect(controller.setWorkspacePolicy("unknown", "balanced")).toBe("auto");
    expect(controller.policy.taskTrustedRoots).toEqual([]);
  });

  it("clears task path grants and YOLO when the Runtime is disposed", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new RuntimeToolSafetyController();
    controller.initialize("/workspace", "trusted", "balanced");
    const pending = bridge.requestApproval({
      ...approvalDetails("dispose", "external-path"),
      taskPathGrant: { kind: "paths", paths: ["/external/project"] }
    });
    const request = events.find((event) => event.type === "approval.requested");
    if (request?.type !== "approval.requested") throw new Error("Expected path approval request.");
    controller.resolveApproval(
      bridge,
      request.payload.requestId,
      request.payload.toolCallId,
      "trust-task-paths-and-allow"
    );
    await pending;
    controller.setTaskToolMode("yolo");

    controller.resetTaskAuthorizations();

    expect(controller.getTaskToolMode()).toBe("auto");
    expect(controller.policy.taskTrustedRoots).toEqual([]);
  });

  it("never turns a hard-stop path candidate into a task grant", () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new RuntimeToolSafetyController();
    controller.initialize("/workspace", "trusted", "balanced");
    void bridge.requestApproval({
      ...approvalDetails("delete-path", "bulk-delete"),
      taskPathGrant: { kind: "paths", paths: ["/external/project"] }
    });
    const request = events.find((event) => event.type === "approval.requested");
    if (request?.type !== "approval.requested") throw new Error("Expected hard-stop approval request.");

    expect(controller.resolveApproval(
      bridge,
      request.payload.requestId,
      request.payload.toolCallId,
      "trust-task-paths-and-allow"
    )).toEqual({ resolved: false, taskToolMode: "auto" });
    expect(controller.policy.taskTrustedRoots).toEqual([]);
    bridge.dispose();
  });

  it("enables YOLO only from an ordinary request and keeps hard-stop approvals pending", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new RuntimeToolSafetyController();
    controller.initialize("/workspace", "trusted", "balanced");

    const ordinary = bridge.requestApproval(approvalDetails("ordinary", "git-external-action"));
    const destructive = bridge.requestApproval(approvalDetails("delete", "bulk-delete"));
    const requests = events.filter((event) => event.type === "approval.requested");
    const ordinaryRequest = requests[0];
    const destructiveRequest = requests[1];
    if (ordinaryRequest?.type !== "approval.requested" || destructiveRequest?.type !== "approval.requested") {
      throw new Error("Expected ordinary and destructive approval requests.");
    }

    expect(bridge.hasPendingHardStopApproval(
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId
    )).toBe(true);

    expect(controller.resolveApproval(
      bridge,
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId,
      "enable-task-yolo-and-allow"
    )).toEqual({ resolved: false, taskToolMode: "auto" });

    expect(controller.resolveApproval(
      bridge,
      ordinaryRequest.payload.requestId,
      ordinaryRequest.payload.toolCallId,
      "enable-task-yolo-and-allow"
    )).toEqual({ resolved: true, taskToolMode: "yolo" });
    await expect(ordinary).resolves.toEqual({ status: "allowed" });
    expect(bridge.hasPendingApproval(
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId
    )).toBe(true);
    expect(controller.resolveApproval(
      bridge,
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId,
      "allow-once"
    )).toEqual({ resolved: true, taskToolMode: "yolo" });
    await expect(destructive).resolves.toEqual({ status: "allowed" });
    expect(bridge.hasPendingApproval(
      ordinaryRequest.payload.requestId,
      ordinaryRequest.payload.toolCallId
    )).toBe(false);
  });
});

function approvalDetails(
  suffix: string,
  category: ApprovalRequestDetails["category"]
): ApprovalRequestDetails {
  return {
    toolCallId: `tool-${suffix}`,
    toolName: "bash",
    toolSource: "Pi 内置",
    category,
    reason: category,
    targetKind: "command",
    target: category === "bulk-delete" ? "rm -rf build" : "git push origin main",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call"
  };
}
