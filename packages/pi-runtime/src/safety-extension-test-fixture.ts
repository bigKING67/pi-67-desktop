import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean; signal?: AbortSignal }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

export function trustedPolicy(): SafetyPolicyState {
  return {
    cwd: "/workspace",
    trust: "trusted",
    approvalMode: "guided",
    taskToolMode: "ask"
  };
}

export function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getAllTools: () => ReturnType<ExtensionAPI["getAllTools"]> = () => [builtinTool("bash")],
  getActiveTools?: () => string[],
  recordToolAuthorization?: Parameters<typeof createDesktopSafetyExtension>[4],
  getInteractionMode?: Parameters<typeof createDesktopSafetyExtension>[5]
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools,
    getActiveTools: getActiveTools ?? (() => getAllTools().map((tool) => tool.name)),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(
    () => policy,
    requestApproval,
    undefined,
    undefined,
    recordToolAuthorization,
    getInteractionMode
  );
  if (!("factory" in extension)) throw new Error("Expected the named Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

export function sdkTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: { path: `<sdk:${name}>`, source: "sdk", scope: "temporary", origin: "top-level" }
  };
}

export function builtinTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: `<builtin:${name}>`, source: "builtin", scope: "temporary", origin: "top-level" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}

export function extensionTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: { path: `/extensions/${name}.ts`, source: "extension", scope: "user", origin: "top-level" }
  };
}

export function packageTool(
  name: string,
  source: string
): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  };
}

export function desktopAttachmentTool(): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool("read_attachment"),
    sourceInfo: {
      path: "<inline:pi67-desktop-attachments>",
      source: "inline",
      scope: "temporary",
      origin: "top-level"
    }
  };
}
