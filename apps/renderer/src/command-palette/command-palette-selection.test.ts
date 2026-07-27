import { Command } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { PaletteAction } from "./command-palette-model.js";
import {
  boundaryPaletteSelection,
  movePaletteSelection,
  repairPaletteSelection
} from "./command-palette-selection.js";

const ITEMS: PaletteAction[] = [
  action("disabled:first", true),
  action("enabled:one"),
  action("disabled:middle", true),
  action("enabled:two")
];

describe("command palette selection", () => {
  it("never repairs selection to a disabled item", () => {
    expect(repairPaletteSelection(ITEMS, "disabled:first")).toBe("enabled:one");
    expect(repairPaletteSelection(ITEMS, "enabled:two")).toBe("enabled:two");
    expect(repairPaletteSelection(ITEMS.map((item) => ({ ...item, disabled: true })), undefined)).toBeUndefined();
  });

  it("cycles only through enabled items and supports boundaries", () => {
    expect(movePaletteSelection(ITEMS, undefined, 1)).toBe("enabled:one");
    expect(movePaletteSelection(ITEMS, "enabled:one", 1)).toBe("enabled:two");
    expect(movePaletteSelection(ITEMS, "enabled:two", 1)).toBe("enabled:one");
    expect(movePaletteSelection(ITEMS, "enabled:one", -1)).toBe("enabled:two");
    expect(boundaryPaletteSelection(ITEMS, "first")).toBe("enabled:one");
    expect(boundaryPaletteSelection(ITEMS, "last")).toBe("enabled:two");
  });
});

function action(id: string, disabled = false): PaletteAction {
  return {
    id,
    group: "actions",
    label: id,
    detail: id,
    keywords: id,
    icon: Command,
    disabled,
    run: () => undefined
  };
}
