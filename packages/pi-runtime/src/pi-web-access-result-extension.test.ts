import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createDesktopPiWebAccessResultExtension } from "./pi-web-access-result-extension.js";

type ToolResultHandler = (
  event: ToolResultEvent
) => Promise<{ content?: ToolResultEvent["content"] } | undefined>;

describe("createDesktopPiWebAccessResultExtension", () => {
  it("projects a verified web search's stored result ID into model-visible content", async () => {
    const handler = resultHandler([
      packageTool("web_search", "npm:pi-web-access@0.17.0")
    ]);

    const result = await handler(toolResult("web_search", { searchId: "msa414lu44z1ze" }));

    expect(result?.content).toEqual([
      { type: "text", text: "Search completed." },
      {
        type: "text",
        text: "Stored result responseId: msa414lu44z1ze. To inspect it, call get_search_content with responseId \"msa414lu44z1ze\" plus a query/url selector."
      }
    ]);
  });

  it("projects response IDs returned by verified fetch and source-check Tools", async () => {
    const handler = resultHandler([
      packageTool("fetch_content", "npm:pi-web-access"),
      packageTool("source_check", "npm:pi-web-access@0.17.0")
    ]);

    for (const toolName of ["fetch_content", "source_check"] as const) {
      const result = await handler(toolResult(toolName, { responseId: `${toolName}-result` }));
      expect(result?.content?.at(-1)).toEqual(expect.objectContaining({
        type: "text",
        text: expect.stringContaining(`responseId: ${toolName}-result`)
      }));
    }
  });

  it("does not duplicate an ID already present in Tool Result text", async () => {
    const handler = resultHandler([
      packageTool("source_check", "npm:pi-web-access@0.17.0")
    ]);

    await expect(handler(toolResult(
      "source_check",
      { responseId: "source-result-67" },
      { content: [{ type: "text", text: "Stored as source-result-67." }] }
    ))).resolves.toBeUndefined();
  });

  it("does not modify failed results, retrieval results, or unrelated Tools", async () => {
    const handler = resultHandler([
      packageTool("web_search", "npm:pi-web-access@0.17.0"),
      packageTool("get_search_content", "npm:pi-web-access@0.17.0"),
      packageTool("other_tool", "npm:pi-web-access@0.17.0")
    ]);

    await expect(handler(toolResult(
      "web_search",
      { searchId: "failed-search" },
      { isError: true }
    ))).resolves.toBeUndefined();
    await expect(handler(toolResult(
      "get_search_content",
      { responseId: "retrieval-result" }
    ))).resolves.toBeUndefined();
    await expect(handler(toolResult(
      "other_tool",
      { responseId: "other-result" }
    ))).resolves.toBeUndefined();
  });

  it("does not trust same-name Tools from another Package or ambiguous duplicates", async () => {
    const unverified = resultHandler([
      packageTool("web_search", "npm:unrelated-extension@1.0.0")
    ]);
    const duplicate = resultHandler([
      packageTool("web_search", "npm:pi-web-access@0.17.0"),
      packageTool("web_search", "npm:unrelated-extension@1.0.0")
    ]);
    const event = toolResult("web_search", { searchId: "untrusted-result" });

    await expect(unverified(event)).resolves.toBeUndefined();
    await expect(duplicate(event)).resolves.toBeUndefined();
  });

  it("rejects malformed, blank, and overlong stored result IDs", async () => {
    const handler = resultHandler([
      packageTool("web_search", "npm:pi-web-access@0.17.0")
    ]);

    for (const searchId of ["", "../secret", "contains spaces", "a".repeat(129), 67]) {
      await expect(handler(toolResult("web_search", { searchId }))).resolves.toBeUndefined();
    }
  });
});

function resultHandler(tools: ReturnType<ExtensionAPI["getAllTools"]>): ToolResultHandler {
  let handler: ToolResultHandler | undefined;
  const api = {
    getAllTools: () => tools,
    on(event: string, candidate: ToolResultHandler) {
      if (event === "tool_result") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopPiWebAccessResultExtension();
  if (!("factory" in extension)) throw new Error("Expected the Desktop result extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop result extension did not register a tool_result handler.");
  return handler;
}

function toolResult(
  toolName: string,
  details: unknown,
  options: {
    content?: ToolResultEvent["content"];
    isError?: boolean;
  } = {}
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: `${toolName}-call`,
    toolName,
    input: {},
    content: options.content ?? [{ type: "text", text: "Search completed." }],
    details,
    isError: options.isError ?? false
  } as ToolResultEvent;
}

function packageTool(name: string, source: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
