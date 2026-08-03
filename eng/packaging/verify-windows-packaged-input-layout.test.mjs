import { describe, expect, it, vi } from "vitest";
import {
  assertLayoutObservation,
  locateTaskInspector,
  prepareResponsiveLayoutControls,
  viewportWidthMatches,
  WINDOWS_SYNTHETIC_SCALE_FACTORS
} from "./verify-windows-packaged-input-layout.mjs";

describe("Windows packaged synthetic-scale UI contract", () => {
  it("keeps the release scale matrix explicit", () => {
    expect(WINDOWS_SYNTHETIC_SCALE_FACTORS).toEqual([1.25, 1.5, 2]);
  });

  it("locates only the task inspector complementary region", () => {
    const inspector = {};
    const getByRole = vi.fn(() => inspector);

    expect(locateTaskInspector({ getByRole })).toBe(inspector);
    expect(getByRole).toHaveBeenCalledWith("complementary", {
      exact: true,
      name: "任务检查器"
    });
  });

  it("creates the running-operation draft state required to measure Send and Stop", async () => {
    const fill = vi.fn();
    const sendWaitFor = vi.fn();
    const stopWaitFor = vi.fn();
    const window = {
      getByLabel: vi.fn(() => ({ fill })),
      getByRole: vi.fn((_role, options) => ({
        waitFor: options.name === "发送" ? sendWaitFor : stopWaitFor
      }))
    };

    await prepareResponsiveLayoutControls(window);

    expect(window.getByLabel).toHaveBeenCalledWith("给 Pi 发送消息");
    expect(fill).toHaveBeenCalledWith("Windows packaged responsive layout probe");
    expect(window.getByRole).toHaveBeenNthCalledWith(1, "button", {
      exact: true,
      name: "发送"
    });
    expect(window.getByRole).toHaveBeenNthCalledWith(2, "button", {
      exact: true,
      name: "停止"
    });
    expect(sendWaitFor).toHaveBeenCalledWith({ state: "visible" });
    expect(stopWaitFor).toHaveBeenCalledWith({ state: "visible" });
  });

  it("accepts contained topmost controls and the native title-bar reserve", () => {
    expect(() => assertLayoutObservation(observation(), {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).not.toThrow();
  });

  it("rejects covered controls and horizontal overflow", () => {
    expect(() => assertLayoutObservation({
      ...observation(),
      horizontalOverflow: 12,
      send: { contained: true, topmost: false }
    }, {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).toThrow(/overflows horizontally/u);
  });

  it("distinguishes an unavailable control from clipping or coverage", () => {
    expect(() => assertLayoutObservation({
      ...observation(),
      send: null
    }, {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).toThrow(/Send is unavailable/u);
    expect(() => assertLayoutObservation({
      ...observation(),
      send: { contained: true, topmost: false }
    }, {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).toThrow(/Send is covered/u);
  });

  it("accepts the renderer width left by the native frame at the production minimum", () => {
    expect(viewportWidthMatches({
      allowNativeFrameFloor: true,
      expectedWidth: 760,
      innerWidth: 744,
      outerWidth: 760
    })).toBe(true);
    expect(() => assertLayoutObservation({
      ...observation(),
      innerWidth: 744,
      matchesContextBreakpoint: true,
      matchesNavigationBreakpoint: true,
      outerWidth: 760,
      titleBar: { bottom: 42, height: 42, left: 0, right: 744, top: 0, width: 744 }
    }, {
      allowNativeFrameFloor: true,
      breakpoint: "navigation-drawer",
      expectedWidth: 760,
      requestedScaleFactor: 1.5
    })).not.toThrow();
  });

  it("rejects arbitrary narrow viewports as native minimum clamping", () => {
    expect(viewportWidthMatches({
      allowNativeFrameFloor: true,
      expectedWidth: 760,
      innerWidth: 700,
      outerWidth: 716
    })).toBe(false);
  });
});

function observation() {
  return {
    composer: { bottom: 780, height: 140, left: 240, right: 1_030, top: 640, width: 790 },
    contextDrawerVisible: true,
    devicePixelRatio: 1.5,
    horizontalOverflow: 0,
    innerHeight: 800,
    innerWidth: 1_040,
    matchesContextBreakpoint: true,
    matchesNavigationBreakpoint: false,
    navigationDrawerVisible: false,
    outerWidth: 1_040,
    send: { contained: true, topmost: true },
    stop: { contained: true, topmost: true },
    titleBar: { bottom: 42, height: 42, left: 0, right: 1_040, top: 0, width: 1_040 },
    titleBarNativeControlReserve: 152,
    visualViewportHeight: 800,
    visualViewportWidth: 1_040
  };
}
