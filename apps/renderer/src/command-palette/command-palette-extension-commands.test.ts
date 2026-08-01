import { describe, expect, it } from "vitest";
import { normalizePaletteExtensionCommands } from "./command-palette-extension-commands.js";

describe("command palette Extension Commands", () => {
  it("normalizes bounded metadata", () => {
    expect(normalizePaletteExtensionCommands({ items: [{
      name: " review ",
      source: "extension",
      description: " Inspect changes ",
      adapter: {
        adapterId: "verified",
        package: "@verified/example",
        label: "检查",
        description: "Adapter description"
      }
    }], total: 1, truncated: false })).toEqual([{
      name: "review",
      source: "extension",
      description: "Inspect changes",
      adapter: {
        adapterId: "verified",
        package: "@verified/example",
        label: "检查",
        description: "Adapter description"
      }
    }]);
  });

  it("fails closed on empty, oversized, or duplicate command identities", () => {
    expect(normalizePaletteExtensionCommands({ items: [{ name: "", source: "extension" }], total: 1, truncated: false })).toBeUndefined();
    expect(normalizePaletteExtensionCommands({ items: [{ name: "x".repeat(161), source: "extension" }], total: 1, truncated: false })).toBeUndefined();
    expect(normalizePaletteExtensionCommands({
      items: [
        { name: "review", source: "extension" },
        { name: " review ", source: "extension" }
      ],
      total: 2,
      truncated: false
    })).toBeUndefined();
  });
});
