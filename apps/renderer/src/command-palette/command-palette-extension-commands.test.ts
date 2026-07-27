import { describe, expect, it } from "vitest";
import { normalizePaletteExtensionCommands } from "./command-palette-extension-commands.js";

describe("command palette Extension Commands", () => {
  it("normalizes bounded metadata", () => {
    expect(normalizePaletteExtensionCommands([{
      name: " review ",
      description: " Inspect changes ",
      adapter: {
        adapterId: "verified",
        package: "@verified/example",
        label: "检查",
        description: "Adapter description"
      }
    }])).toEqual([{
      name: "review",
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
    expect(normalizePaletteExtensionCommands([{ name: "" }])).toBeUndefined();
    expect(normalizePaletteExtensionCommands([{ name: "x".repeat(161) }])).toBeUndefined();
    expect(normalizePaletteExtensionCommands([{ name: "review" }, { name: " review " }])).toBeUndefined();
  });
});
