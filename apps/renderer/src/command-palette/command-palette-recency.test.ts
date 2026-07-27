import { beforeEach, describe, expect, it } from "vitest";
import {
  getRecentPaletteActionIds,
  rememberPaletteAction,
  resetPaletteRecencyForTest
} from "./command-palette-recency.js";

describe("command palette recency", () => {
  beforeEach(resetPaletteRecencyForTest);

  it("keeps a bounded, unique process-local order", () => {
    for (let index = 0; index < 8; index += 1) rememberPaletteAction(`action:${index}`);
    rememberPaletteAction("action:5");

    expect(getRecentPaletteActionIds()).toEqual([
      "action:5",
      "action:7",
      "action:6",
      "action:4",
      "action:3",
      "action:2"
    ]);
  });
});
