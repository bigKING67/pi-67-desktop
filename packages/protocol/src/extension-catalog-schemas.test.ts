import {
  MAX_EXTENSION_CATALOG_DETAIL_CHARS,
  MAX_EXTENSION_CATALOG_ITEMS,
  MAX_EXTENSION_CATALOG_LABEL_CHARS,
  MAX_EXTENSION_CATALOG_PATH_CHARS,
  MAX_EXTENSION_CATALOG_TOOL_NAME_CHARS,
  MAX_EXTENSION_CATALOG_TOOL_NAMES,
  MAX_EXTENSION_SURFACE_DETAIL_CHARS
} from "@pi67/domain";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ExtensionCatalogSchema,
  ExtensionToolAdapterSchema
} from "./extension-catalog-schemas.js";

describe("ExtensionCatalogSchema", () => {
  it("accepts delegated presentation only as bounded Adapter metadata", () => {
    expect(Value.Check(ExtensionToolAdapterSchema, {
      adapterId: "verified-delegation",
      package: "@verified/delegation",
      presentation: "delegated",
      label: "Delegate task"
    })).toBe(true);
    expect(Value.Check(ExtensionToolAdapterSchema, {
      adapterId: "verified-delegation",
      package: "@verified/delegation",
      presentation: "subagent"
    })).toBe(false);
  });

  it("accepts a bounded per-surface catalog", () => {
    expect(Value.Check(ExtensionCatalogSchema, catalog())).toBe(true);
  });

  it("rejects unknown fields, incomplete surfaces, and invalid compatibility values", () => {
    expect(Value.Check(ExtensionCatalogSchema, catalog({ unknown: true }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      assessment: { ...item().assessment, surfaces: item().assessment.surfaces.slice(0, 3) }
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      assessment: { ...item().assessment, overall: "fully-compatible" }
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      adapter: { ...item().adapter, executable: "renderer.js" }
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      adapter: { ...item().adapter, surfaces: [] }
    }))).toBe(false);
  });

  it("rejects unbounded catalog fields and item counts", () => {
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, { id: text(MAX_EXTENSION_CATALOG_PATH_CHARS + 1) }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, { label: text(MAX_EXTENSION_CATALOG_LABEL_CHARS + 1) }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      assessment: { ...item().assessment, detail: text(MAX_EXTENSION_CATALOG_DETAIL_CHARS + 1) }
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      assessment: {
        ...item().assessment,
        surfaces: item().assessment.surfaces.map((surface, index) => index === 0
          ? { ...surface, detail: text(MAX_EXTENSION_SURFACE_DETAIL_CHARS + 1) }
          : surface)
      }
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      toolNames: Array.from({ length: MAX_EXTENSION_CATALOG_TOOL_NAMES + 1 }, (_, index) => `tool-${index}`)
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, catalog({}, {
      toolNames: [text(MAX_EXTENSION_CATALOG_TOOL_NAME_CHARS + 1)]
    }))).toBe(false);
    expect(Value.Check(ExtensionCatalogSchema, {
      ...catalog(),
      items: Array.from({ length: MAX_EXTENSION_CATALOG_ITEMS + 1 }, () => item())
    })).toBe(false);
  });
});

function catalog(
  resultOverrides: Record<string, unknown> = {},
  itemOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    items: [item(itemOverrides)],
    total: 1,
    truncated: false,
    ...resultOverrides
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "/extensions/example.ts",
    label: "example-extension",
    path: "/extensions/example.ts",
    loadState: "loaded",
    source: {
      path: "/extensions/example.ts",
      source: "example-extension",
      scope: "project",
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
      overall: "partial",
      detail: "Some surfaces are available.",
      surfaces: [
        { surface: "commands", status: "supported", detail: "One command." },
        { surface: "tools", status: "partial", detail: "Generic card." },
        { surface: "ui-primitives", status: "unknown", detail: "No attribution." },
        { surface: "tui-custom", status: "tui-only", detail: "TUI renderer." }
      ]
    },
    commandCount: 1,
    toolCount: 1,
    toolNames: ["read_artifact"],
    ...overrides
  };
}

function text(length: number): string {
  return "x".repeat(length);
}
