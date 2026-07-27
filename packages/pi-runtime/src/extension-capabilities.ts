import type { RuntimeCapabilities } from "@pi67/domain";

export interface ExtensionAdapterCapabilityState {
  available: boolean;
  supportedSurfaces: Array<"commands" | "tools">;
  activeAdapterCount: number;
}

const DEFAULT_ADAPTER_CAPABILITIES: ExtensionAdapterCapabilityState = {
  available: true,
  supportedSurfaces: ["commands", "tools"],
  activeAdapterCount: 0
};

export function getDesktopExtensionUiCapabilities(
  adapters: ExtensionAdapterCapabilityState = DEFAULT_ADAPTER_CAPABILITIES
): RuntimeCapabilities["extensionUi"] {
  return {
    primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
    attribution: "none",
    recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
    adapterRegistry: {
      available: adapters.available,
      manifestSchemaVersions: adapters.available ? [1] : [],
      supportedSurfaces: adapters.supportedSurfaces,
      realtimeUiAttribution: false,
      activeAdapterCount: adapters.activeAdapterCount
    },
    limitations: {
      workingIndicator: "unsupported",
      editorMutation: "unsupported",
      customComponents: "tui-only",
      autocomplete: "tui-only",
      widgetPlacements: ["aboveEditor", "belowEditor"]
    }
  };
}
