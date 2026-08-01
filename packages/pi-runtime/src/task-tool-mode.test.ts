import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

describe("PiSdkRuntime task Tool mode", () => {
  it("starts in AUTO, requires trust for YOLO, and resets to AUTO when trust is revoked", async () => {
    const runtime = new PiSdkRuntime();
    try {
      expect(runtime.getTaskToolMode()).toBe("auto");
      expect(() => runtime.setTaskToolMode("yolo")).toThrowError(expect.objectContaining({
        code: "WORKSPACE_NOT_TRUSTED"
      }));

      runtime.setWorkspacePolicy("trusted", "balanced");
      expect(runtime.setTaskToolMode("ask")).toBe("ask");
      expect(runtime.setTaskToolMode("yolo")).toBe("yolo");
      expect(runtime.setWorkspacePolicy("unknown", "balanced")).toBe("auto");
      expect(runtime.getTaskToolMode()).toBe("auto");
    } finally {
      await runtime.dispose();
    }
  });

  it("lets trusted YOLO bypass even unverified registered Tools but never bypasses Workspace trust", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const tools = () => [packageTool("unknown_tool", "npm:unknown-extension@1.0.0")];
    const trustedYolo = safetyHandler({
      cwd: "/workspace",
      trust: "trusted",
      approvalMode: "balanced",
      taskToolMode: "yolo"
    }, requestApproval, tools);
    const untrustedYolo = safetyHandler({
      cwd: "/workspace",
      trust: "unknown",
      approvalMode: "balanced",
      taskToolMode: "yolo"
    }, requestApproval, tools);

    await expect(trustedYolo({
      toolCallId: "unknown-trusted-yolo",
      toolName: "unknown_tool",
      input: { any: "value" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(untrustedYolo({
      toolCallId: "unknown-untrusted-yolo",
      toolName: "unknown_tool",
      input: { any: "value" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "Workspace is not trusted."
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getTools: () => ReturnType<ExtensionAPI["getAllTools"]>
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools: getTools,
    getActiveTools: () => getTools().map((tool) => tool.name),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(() => policy, requestApproval);
  if (!("factory" in extension)) throw new Error("Expected the Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

function packageTool(
  name: string,
  source: string
): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
