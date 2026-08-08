export type NativeCapabilityReplacement = "native-plan" | "native-web";

const REPLACED_PACKAGE_SOURCES = new Map<string, NativeCapabilityReplacement>([
  ["npm:@narumitw/pi-plan-mode", "native-plan"],
  ["npm:pi-web-access", "native-web"],
  ["npm:pi-smart-fetch", "native-web"]
]);

export function nativeCapabilityReplacement(source: string): NativeCapabilityReplacement | undefined {
  const normalized = source.trim().replace(/@(?:\^|~)?\d[^/]*$/u, "");
  return REPLACED_PACKAGE_SOURCES.get(normalized);
}

export function nativeCapabilityReplacementLabel(replacement: NativeCapabilityReplacement): string {
  return replacement === "native-plan" ? "由 Pi-67 原生 Plan Mode 替代" : "由 Pi-67 原生搜索替代";
}
