import { describe, expect, it } from "vitest";
import { titleBarOverlay } from "./title-bar-overlay.js";

describe("native title bar overlay", () => {
  it("keeps native controls legible in dark and light themes", () => {
    expect(titleBarOverlay(true)).toEqual({ color: "#111412", symbolColor: "#f0f3ef", height: 42 });
    expect(titleBarOverlay(false)).toEqual({ color: "#f5f6f4", symbolColor: "#171a18", height: 42 });
  });
});
