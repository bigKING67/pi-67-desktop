import type { ApprovalRequestDetails } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";

describe("RuntimeToolSafetyController", () => {
  it("enables YOLO for ordinary approvals without granting a hard-stop request", async () => {
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

    expect(controller.resolveApproval(
      bridge,
      ordinaryRequest.payload.requestId,
      ordinaryRequest.payload.toolCallId,
      "enable-task-yolo-and-allow"
    )).toEqual({ resolved: true, taskToolMode: "yolo" });
    await expect(ordinary).resolves.toEqual({ status: "allowed" });
    expect(bridge.hasPendingHardStopApproval(
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId
    )).toBe(true);

    expect(controller.resolveApproval(
      bridge,
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId,
      "enable-task-yolo-and-allow"
    )).toEqual({ resolved: false, taskToolMode: "yolo" });
    expect(controller.resolveApproval(
      bridge,
      destructiveRequest.payload.requestId,
      destructiveRequest.payload.toolCallId,
      "allow-once"
    )).toEqual({ resolved: true, taskToolMode: "yolo" });
    await expect(destructive).resolves.toEqual({ status: "allowed" });
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
