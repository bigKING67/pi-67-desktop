import { createCodemodeExtension, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";

export const DESKTOP_CODEMODE_EXTENSION_PATH = "<inline:pi67-desktop-codemode>";

export function createDesktopCodemodeExtension(getDefaultTools: () => readonly string[] | undefined = () => undefined): InlineExtension {
  return {
    name: "pi67-desktop-codemode",
    hidden: true,
    factory: (pi) => createCodemodeExtension({ mode: "on", models: false, saveOutput: false })({
      ...pi,
      registerTool: (tool) => {
        if (tool.name !== "codemode") throw new Error("Unexpected Pi Codemode tool registration");
        // Pi activates extension defaults additively even with defaultTools.
        // Read the admitted SettingsManager explicitly, without writing it or
        // replacing active tools from a session-start hook.
        const defaults = getDefaultTools();
        pi.registerTool({ ...tool, defaultActive: defaults === undefined || defaults.includes("codemode") });
      }
    })
  };
}

export function isVerifiedDesktopCodemode(pi: ExtensionAPI, input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  if (typeof record.code !== "string" || Object.keys(record).some((key) => key !== "code")) return false;
  const matches = pi.getAllTools().filter((tool) => tool.name === "codemode");
  if (matches.length !== 1) return false;
  const source = matches[0]!.sourceInfo;
  return source.source === "inline" && source.path === DESKTOP_CODEMODE_EXTENSION_PATH
    && source.scope === "temporary" && source.origin === "top-level";
}
