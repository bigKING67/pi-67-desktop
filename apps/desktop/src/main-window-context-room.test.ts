import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, Rectangle } from "electron";
import { DESKTOP_CONTEXT_DRAWER_MAX_WIDTH } from "@pi67/protocol";
import { ensureMainWindowContextRoom } from "./main-window-context-room.js";

describe("main window context room", () => {
  it("keeps an already-wide content area unchanged", () => {
    const fixture = createWindowFixture(DESKTOP_CONTEXT_DRAWER_MAX_WIDTH + 1);

    expect(ensureMainWindowContextRoom(fixture.window, workArea(1_440))).toBe(true);
    expect(fixture.setBounds).not.toHaveBeenCalled();
  });

  it("grows and repositions a normal window inside the active display", () => {
    const fixture = createWindowFixture(1_200, { width: 1_216, x: 180 });

    expect(ensureMainWindowContextRoom(fixture.window, workArea(1_440))).toBe(true);
    expect(fixture.setBounds).toHaveBeenCalledWith({
      height: 900,
      width: DESKTOP_CONTEXT_DRAWER_MAX_WIDTH + 17,
      x: 103,
      y: 40
    });
  });

  it("uses the drawer when the display or native window state cannot fit a docked region", () => {
    const constrained = createWindowFixture(1_200);
    expect(ensureMainWindowContextRoom(constrained.window, workArea(1_280))).toBe(false);
    expect(constrained.setBounds).not.toHaveBeenCalled();

    const maximized = createWindowFixture(1_200, {}, { maximized: true });
    expect(ensureMainWindowContextRoom(maximized.window, workArea(1_920))).toBe(false);
    expect(maximized.setBounds).not.toHaveBeenCalled();
  });
});

function createWindowFixture(
  initialContentWidth: number,
  boundsOverride: Partial<Rectangle> = {},
  state: { maximized?: boolean; fullScreen?: boolean } = {}
) {
  let contentWidth = initialContentWidth;
  let bounds: Rectangle = { height: 900, width: initialContentWidth + 16, x: 100, y: 40, ...boundsOverride };
  const setBounds = vi.fn((next: Rectangle) => {
    bounds = next;
    contentWidth = Math.max(0, next.width - 16);
  });
  const window = {
    getBounds: () => bounds,
    getContentSize: () => [contentWidth, 860] as [number, number],
    isDestroyed: () => false,
    isFullScreen: () => state.fullScreen === true,
    isMaximized: () => state.maximized === true,
    setBounds
  } as unknown as Pick<
    BrowserWindow,
    "getBounds" | "getContentSize" | "isDestroyed" | "isFullScreen" | "isMaximized" | "setBounds"
  >;
  return { setBounds, window };
}

function workArea(width: number): Rectangle {
  return { height: 1_080, width, x: 0, y: 0 };
}
