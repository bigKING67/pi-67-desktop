export type NativeCapabilityReplacement = "native-plan" | "native-web" | "native-subagents" | "native-mcp";

const REPLACED_PACKAGE_SOURCES = new Map<string, NativeCapabilityReplacement>([
  ["npm:@narumitw/pi-plan-mode", "native-plan"],
  ["npm:pi-web-access", "native-web"],
  ["npm:pi-smart-fetch", "native-web"],
  ["npm:pi-subagents", "native-subagents"],
  ["npm:pi-mcp-adapter", "native-mcp"]
]);

export function nativeCapabilityReplacement(source: string): NativeCapabilityReplacement | undefined {
  const normalized = /^(npm:(?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?$/u.exec(source.trim())?.[1];
  if (!normalized) return undefined;
  return REPLACED_PACKAGE_SOURCES.get(normalized);
}

export function nativeCapabilityReplacementLabel(replacement: NativeCapabilityReplacement): string {
  if (replacement === "native-plan") return "由 Pi-67 原生 Plan Mode 替代";
  if (replacement === "native-subagents") return "由 Pi-67 原生子代理替代";
  if (replacement === "native-mcp") return "由 Pi-67 原生 MCP 替代";
  return "由 Pi-67 原生搜索替代";
}
