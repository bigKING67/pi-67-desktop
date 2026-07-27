import { describe, expect, it } from "vitest";
import { getDesktopExtensionUiCapabilities } from "./extension-capabilities.js";

describe("getDesktopExtensionUiCapabilities", () => {
  it("advertises only the declarative UI surface implemented end to end", () => {
    expect(getDesktopExtensionUiCapabilities()).toEqual({
      primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
      attribution: "none",
      recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
      adapterRegistry: {
        available: true,
        manifestSchemaVersions: [1],
        supportedSurfaces: ["commands", "tools"],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported",
        editorMutation: "unsupported",
        customComponents: "tui-only",
        autocomplete: "tui-only",
        widgetPlacements: ["aboveEditor", "belowEditor"]
      }
    });
  });

  it("reports the active Adapter count without claiming realtime UI attribution", () => {
    const capabilities = getDesktopExtensionUiCapabilities({
      available: true,
      supportedSurfaces: ["commands", "tools"],
      activeAdapterCount: 3
    });

    expect(capabilities.adapterRegistry.activeAdapterCount).toBe(3);
    expect(capabilities.adapterRegistry.realtimeUiAttribution).toBe(false);
    expect(capabilities.attribution).toBe("none");
  });
});
