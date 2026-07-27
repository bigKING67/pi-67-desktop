import type { ExtensionCatalogResult, RuntimeCapabilities } from "../../packages/domain/src/index.js";
import type { CommandDescriptor } from "../../packages/protocol/src/index.js";

export const MOCK_EXTENSION_COMMANDS = [{
  name: "inspect",
  description: "Inspect runtime",
  adapter: {
    adapterId: "verified-example",
    package: "@verified/example",
    label: "检查"
  }
}] satisfies CommandDescriptor[];

export const MOCK_RUNTIME_CAPABILITIES = {
  sdkVersion: "0.81.1",
  supportsFollowUp: true,
  supportsSessionTree: true,
  extensionUi: {
    primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
    attribution: "none",
    recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
    adapterRegistry: {
      available: true,
      manifestSchemaVersions: [1],
      supportedSurfaces: ["commands", "tools"],
      realtimeUiAttribution: false,
      activeAdapterCount: 1
    },
    limitations: {
      workingIndicator: "unsupported",
      editorMutation: "unsupported",
      customComponents: "tui-only",
      autocomplete: "tui-only",
      widgetPlacements: ["aboveEditor", "belowEditor"]
    }
  }
} satisfies RuntimeCapabilities;

export const MOCK_EXTENSION_CATALOG = {
  items: [{
    id: "/Users/test/.pi/agent/extensions/example.ts",
    label: "example-extension",
    path: "/Users/test/.pi/agent/extensions/example.ts",
    loadState: "loaded",
    source: {
      path: "/Users/test/.pi/agent/extensions/example.ts",
      source: "npm:@verified/example@1.2.3",
      scope: "user",
      origin: "package"
    },
    adapter: {
      adapterId: "verified-example",
      schemaVersion: 1,
      package: "@verified/example",
      installedVersion: "1.2.3",
      versionRange: ">=1 <2",
      surfaces: ["commands", "tools"],
      commandCount: 1,
      toolCount: 1
    },
    assessment: {
      overall: "adapter",
      detail: "全部已发现的命令和工具 surface 均由已验证的声明式 Desktop Adapter 覆盖。",
      surfaces: [
        { surface: "commands", status: "supported", detail: "1 个命令。" },
        { surface: "tools", status: "supported", detail: "1 个工具使用声明式展示。" },
        { surface: "ui-primitives", status: "unknown", detail: "没有可靠调用方归属。" },
        { surface: "tui-custom", status: "unknown", detail: "没有足够证据。" }
      ]
    },
    commandCount: 1,
    toolCount: 1
  }],
  total: 1,
  truncated: false
} satisfies ExtensionCatalogResult;
