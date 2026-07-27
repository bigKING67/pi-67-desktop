import { describe, expect, it } from "vitest";
import {
  authorizeControlledProviderApproval,
  CONTROLLED_PROVIDER_TOOL_NAME
} from "./controlled-provider-approval.mjs";

const WORKSPACE = "C:\\runner\\provider-workspace";

describe("controlled Provider approval", () => {
  it("allows only the exact controlled Tool authority", async () => {
    const dialog = fakeDialog({
      toolName: CONTROLLED_PROVIDER_TOOL_NAME,
      target: CONTROLLED_PROVIDER_TOOL_NAME,
      cwd: WORKSPACE
    });

    await expect(authorizeControlledProviderApproval({
      dialog,
      expectedCwd: WORKSPACE,
      protocol: controlledProtocol()
    })).resolves.toEqual({
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      operationId: "operation-1"
    });
    expect(dialog.clicks).toEqual(["仅允许本次"]);
  });

  it.each([
    ["an unexpected shell Tool", { toolName: "bash", targetKind: "command", target: "whoami" }],
    ["another Extension Tool", { toolName: "extension_probe", target: "extension_probe" }],
    ["a mismatched target", { target: "another_target" }],
    ["a mismatched working directory", { cwd: "C:\\runner\\other" }],
    ["a mismatched Operation", { operationId: "operation-2" }],
    ["a reusable approval scope", { scope: "workspace-session" }],
    ["a truncated target", { targetTruncated: true }]
  ])("rejects %s and never clicks allow", async (_label, override) => {
    const protocol = controlledProtocol(override);
    const dialog = fakeDialog({
      toolName: protocol.approval.toolName,
      target: protocol.approval.target,
      cwd: protocol.approval.cwd
    });

    await expect(authorizeControlledProviderApproval({
      dialog,
      expectedCwd: WORKSPACE,
      protocol
    })).rejects.toThrow("Provider requested an unexpected Tool; certification failed closed.");
    expect(dialog.clicks).toEqual(["拒绝"]);
  });
});

function controlledProtocol(override = {}) {
  return {
    hostEpoch: 7,
    operationId: "operation-1",
    approval: {
      sequence: 9,
      hostEpoch: 7,
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      operationId: "operation-1",
      toolName: CONTROLLED_PROVIDER_TOOL_NAME,
      targetKind: "tool",
      target: CONTROLLED_PROVIDER_TOOL_NAME,
      targetTruncated: false,
      cwd: WORKSPACE,
      cwdTruncated: false,
      scope: "single-tool-call",
      ...override
    }
  };
}

function fakeDialog({ toolName, target, cwd, scope = "仅此 Tool Call" }) {
  const values = { "tool-name": toolName, target, cwd };
  const clicks = [];
  return {
    clicks,
    locator(selector) {
      const match = /data-security-literal="([^"]+)"/u.exec(selector);
      return { textContent: async () => values[match?.[1]] };
    },
    getByText() {
      return { textContent: async () => scope };
    },
    getByRole(_role, options) {
      return { click: async () => clicks.push(options.name) };
    }
  };
}
