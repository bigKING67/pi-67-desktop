import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_WEB_ACCESS_SOURCE_PATTERN = /^npm:pi-web-access(?:@|$)/u;

const PI_WEB_ACCESS_READ_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content"
]);

export function isVerifiedPiWebAccessTool(pi: ExtensionAPI, toolName: string): boolean {
  if (!PI_WEB_ACCESS_READ_TOOLS.has(toolName)) return false;
  try {
    const matches = pi.getAllTools().filter((tool) => tool.name === toolName);
    const source = matches.length === 1 ? matches[0]?.sourceInfo : undefined;
    return source?.origin === "package"
      && PI_WEB_ACCESS_SOURCE_PATTERN.test(source.source);
  } catch {
    return false;
  }
}
