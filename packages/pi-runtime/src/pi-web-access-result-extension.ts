import type { InlineExtension, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isVerifiedPiWebAccessTool } from "./pi-web-access-tool-identity.js";

export const DESKTOP_PI_WEB_ACCESS_RESULT_EXTENSION_PATH = "<inline:pi67-desktop-pi-web-access-result>";

export function createDesktopPiWebAccessResultExtension(): InlineExtension {
  return {
    name: "pi67-desktop-pi-web-access-result",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_result", async (event) => {
        if (event.isError || !isVerifiedPiWebAccessTool(pi, event.toolName)) return undefined;
        const reference = storedResultReference(event.toolName, event.details);
        if (!reference || contentIncludes(event.content, reference.responseId)) return undefined;
        return {
          content: [
            ...event.content,
            {
              type: "text",
              text: storedResultInstruction(reference.responseId)
            }
          ]
        };
      });
    }
  };
}

function storedResultReference(
  toolName: string,
  details: unknown
): { responseId: string } | undefined {
  const record = asRecord(details);
  const value = toolName === "web_search"
    ? record.searchId
    : toolName === "source_check" || toolName === "fetch_content"
      ? record.responseId
      : undefined;
  if (typeof value !== "string") return undefined;
  const responseId = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/u.test(responseId) ? { responseId } : undefined;
}

function contentIncludes(content: ToolResultEvent["content"], responseId: string): boolean {
  return content.some((item) => item.type === "text" && item.text.includes(responseId));
}

function storedResultInstruction(responseId: string): string {
  return [
    `Stored result responseId: ${responseId}.`,
    `To inspect it, call get_search_content with responseId "${responseId}" plus a query/url selector.`
  ].join(" ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
