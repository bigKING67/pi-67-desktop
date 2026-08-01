import type {
  Extension,
  LoadExtensionsResult,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAdapterMatch } from "@pi67/extension-compat";
import {
  MAX_EXTENSION_CATALOG_ITEMS,
  MAX_EXTENSION_CATALOG_JSON_BYTES
} from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { projectExtensionCatalog } from "./extension-catalog.js";

describe("projectExtensionCatalog", () => {
  it("filters hidden internal extensions and reports each visible surface conservatively", () => {
    const catalog = projectExtensionCatalog(extensionResult([
      extension("<inline:pi67-desktop-safety>", { hidden: true }),
      extension("example-package", {
        commands: 2,
        toolNames: ["web_search"],
        messageRenderers: 1,
        shortcuts: 1,
        scope: "project",
        origin: "package"
      }),
      extension("event-only")
    ]));

    expect(catalog).toMatchObject({ total: 2, truncated: false });
    expect(catalog.items.map((item) => item.label)).toEqual(["event-only.ts", "example-package"]);
    expect(catalog.items[0]?.assessment).toMatchObject({
      overall: "unknown",
      surfaces: [
        { surface: "commands", status: "not-present" },
        { surface: "tools", status: "not-present" },
        { surface: "ui-primitives", status: "unknown" },
        { surface: "tui-custom", status: "unknown" }
      ]
    });
    expect(catalog.items[1]).toMatchObject({
      loadState: "loaded",
      commandCount: 2,
      toolCount: 1,
      toolNames: ["web_search"],
      source: { scope: "project", origin: "package" },
      assessment: {
        overall: "partial",
        surfaces: [
          { surface: "commands", status: "supported" },
          { surface: "tools", status: "partial" },
          { surface: "ui-primitives", status: "unknown" },
          { surface: "tui-custom", status: "tui-only" }
        ]
      }
    });
  });

  it("fails closed for load errors and redacts secret-shaped error text", () => {
    const catalog = projectExtensionCatalog(extensionResult([], [
      { path: "/extensions/broken.ts", error: "apiKey=sk-secret-value-12345678" },
      { path: "<inline:pi67-desktop-safety>", error: "internal fixture" },
      { path: "<inline:pi67-desktop-tool-routing>", error: "internal fixture" }
    ]));

    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toMatchObject({
      loadState: "failed",
      assessment: { overall: "unsupported" }
    });
    expect(catalog.items[0]?.assessment.detail).not.toContain("secret-value");
  });

  it("reports verified declarative Adapter coverage without upgrading shared UI attribution", () => {
    const loaded = extension("verified-package", {
      commands: 1,
      tools: 1,
      origin: "package"
    });
    const catalog = projectExtensionCatalog(
      extensionResult([loaded]),
      new Map([[loaded.resolvedPath, adapterMatch()]])
    );

    expect(catalog.items[0]).toMatchObject({
      adapter: {
        adapterId: "verified-adapter",
        package: "@verified/example",
        installedVersion: "1.2.3",
        surfaces: ["commands", "tools"],
        commandCount: 1,
        toolCount: 1
      },
      assessment: {
        overall: "adapter",
        surfaces: [
          { surface: "commands", status: "supported" },
          { surface: "tools", status: "supported" },
          { surface: "ui-primitives", status: "unknown" },
          { surface: "tui-custom", status: "unknown" }
        ]
      }
    });
  });

  it("bounds the projected catalog without changing the source result", () => {
    const extensions = Array.from(
      { length: MAX_EXTENSION_CATALOG_ITEMS + 1 },
      (_, index) => extension(`extension-${String(index).padStart(3, "0")}`)
    );
    const catalog = projectExtensionCatalog(extensionResult(extensions));

    expect(catalog.items).toHaveLength(MAX_EXTENSION_CATALOG_ITEMS);
    expect(catalog).toMatchObject({ total: MAX_EXTENSION_CATALOG_ITEMS + 1, truncated: true });
    expect(extensions).toHaveLength(MAX_EXTENSION_CATALOG_ITEMS + 1);
  });

  it("keeps the complete projection below the negotiated catalog byte budget", () => {
    const longName = "中".repeat(30_000);
    const extensions = Array.from(
      { length: 32 },
      (_, index) => extension(`${index}-${longName}`)
    );
    const catalog = projectExtensionCatalog(extensionResult(extensions));

    expect(new TextEncoder().encode(JSON.stringify(catalog)).byteLength)
      .toBeLessThanOrEqual(MAX_EXTENSION_CATALOG_JSON_BYTES);
    expect(catalog.truncated).toBe(true);
    expect(catalog.total).toBe(extensions.length);
  });
});

function extension(
  name: string,
  options: {
    hidden?: boolean;
    commands?: number;
    tools?: number;
    toolNames?: string[];
    messageRenderers?: number;
    entryRenderers?: number;
    shortcuts?: number;
    scope?: SourceInfo["scope"];
    origin?: SourceInfo["origin"];
  } = {}
): Extension {
  const sourceInfo: SourceInfo = {
    path: `/extensions/${name}.ts`,
    source: name,
    scope: options.scope ?? "user",
    origin: options.origin ?? "top-level"
  };
  return {
    path: sourceInfo.path,
    resolvedPath: sourceInfo.path,
    ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
    sourceInfo,
    handlers: new Map(),
    tools: options.toolNames
      ? new Map(options.toolNames.map((toolName) => [toolName, {}]))
      : numberedMap(options.tools),
    messageRenderers: numberedMap(options.messageRenderers),
    entryRenderers: numberedMap(options.entryRenderers),
    commands: numberedMap(options.commands),
    flags: new Map(),
    shortcuts: numberedMap(options.shortcuts)
  } as unknown as Extension;
}

function extensionResult(
  extensions: Extension[],
  errors: Array<{ path: string; error: string }> = []
): LoadExtensionsResult {
  return { extensions, errors, runtime: {} } as LoadExtensionsResult;
}

function numberedMap(count = 0): Map<string, unknown> {
  return new Map(Array.from({ length: count }, (_, index) => [`item-${index}`, {}]));
}

function adapterMatch(): ExtensionAdapterMatch {
  return {
    adapterId: "verified-adapter",
    schemaVersion: 1,
    package: "@verified/example",
    installedVersion: "1.2.3",
    versionRange: ">=1 <2",
    surfaces: ["commands", "tools"],
    commands: [{ name: "item-0", label: "Verified command" }],
    tools: [{ name: "item-0", presentation: "generic", label: "Verified tool" }]
  };
}
