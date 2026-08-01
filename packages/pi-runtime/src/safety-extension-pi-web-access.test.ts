import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

describe("createDesktopSafetyExtension pi-web-access classification", () => {
  it("auto-allows the verified read-only search, verification, fetch, and retrieval chain", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler(requestApproval, [
      packageTool("web_search", "npm:pi-web-access@0.17.0"),
      packageTool("source_check", "npm:pi-web-access@0.17.0"),
      packageTool("fetch_content", "npm:pi-web-access@0.17.0"),
      packageTool("get_search_content", "npm:pi-web-access@0.17.0")
    ]);

    for (const call of [
      { toolCallId: "web", toolName: "web_search", input: { queries: ["杭州天气"] } },
      { toolCallId: "source", toolName: "source_check", input: { claim: "杭州今天最高气温为 39°C" } },
      { toolCallId: "fetch", toolName: "fetch_content", input: { url: "https://example.invalid/weather" } },
      {
        toolCallId: "stored",
        toolName: "get_search_content",
        input: { responseId: "web-search-67", urlIndex: 0, offset: 0, limit: 20_000 }
      }
    ]) {
      await expect(handler(call, { hasUI: true })).resolves.toBeUndefined();
    }
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps malformed contracts behind approval and rejects reserved identity mismatches", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    let tools = [
      packageTool("source_check", "npm:pi-web-access@0.17.0"),
      packageTool("get_search_content", "npm:pi-web-access@0.17.0")
    ];
    const handler = safetyHandler(requestApproval, tools, () => tools);

    await expect(handler({
      toolCallId: "bad-source",
      toolName: "source_check",
      input: { claim: "杭州天气", queries: [""] }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    await expect(handler({
      toolCallId: "bad-retrieval",
      toolName: "get_search_content",
      input: { responseId: "web-search-67", urlIndex: -1 }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    tools = [packageTool("get_search_content", "npm:unrelated-extension@1.0.0")];
    await expect(handler({
      toolCallId: "wrong-source",
      toolName: "get_search_content",
      input: { responseId: "web-search-67" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "Tool `get_search_content` 未通过 pi-web-access 的 Desktop 身份校验；请检查 Package 版本和重复来源。"
    });
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(requestApproval.mock.calls.map(([request]) => request.category)).toEqual([
      "unverified-tool",
      "unverified-tool"
    ]);
  });
});

function safetyHandler(
  requestApproval: DesktopApprovalRequester,
  initialTools: ReturnType<ExtensionAPI["getAllTools"]>,
  getTools: () => ReturnType<ExtensionAPI["getAllTools"]> = () => initialTools
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools: getTools,
    getActiveTools: () => getTools().map((tool) => tool.name),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(() => trustedPolicy(), requestApproval);
  if (!("factory" in extension)) throw new Error("Expected the Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

function trustedPolicy(): SafetyPolicyState {
  return {
    cwd: "/workspace",
    trust: "trusted",
    approvalMode: "balanced",
    taskToolMode: "auto"
  };
}

function packageTool(name: string, source: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
