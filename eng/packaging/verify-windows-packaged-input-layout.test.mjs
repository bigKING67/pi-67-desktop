import { describe, expect, it, vi } from "vitest";
import {
  assertLayoutObservation,
  inspectWindowsSyntheticRuntimeSurface,
  locateTaskInspector,
  prepareResponsiveLayoutControls,
  viewportWidthMatches,
  waitForWindowsSyntheticRuntimeReady,
  WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
  WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS,
  WINDOWS_SYNTHETIC_SCALE_FACTORS,
  WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS
} from "./verify-windows-packaged-input-layout.mjs";

describe("Windows packaged synthetic-scale UI contract", () => {
  it("keeps the release scale matrix explicit", () => {
    expect(WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX).toBe(1_140);
    expect(WINDOWS_SYNTHETIC_SCALE_FACTORS).toEqual([1.25, 1.5, 2]);
    expect(WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS).toBe(60_000);
    expect(WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS).toBe(5_000);
  });

  it("waits for either a ready or explicit failed runtime phase", async () => {
    const waitFor = vi.fn();
    const isVisible = vi.fn(async () => false);
    const failed = { isVisible };
    const ready = { or: vi.fn(() => ({ waitFor })) };
    const window = {
      locator: vi.fn((selector) => selector.includes("ready") ? ready : failed)
    };

    await waitForWindowsSyntheticRuntimeReady(window, () => "", 1.5, 12_345);

    expect(ready.or).toHaveBeenCalledWith(failed);
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 12_345 });
    expect(isVisible).toHaveBeenCalledOnce();
  });

  it("reports bounded runtime and initialization diagnostics on failure", async () => {
    const waitFor = vi.fn(async () => {
      throw new Error("timeout");
    });
    const failed = { isVisible: vi.fn(async () => false) };
    const ready = { or: vi.fn(() => ({ waitFor })) };
    const surface = {
      acknowledgementTimedOut: false,
      conversationRowCount: 0,
      runtimePhase: "starting",
      title: "Pi-67 Desktop",
      url: "app://pi67/index.html",
      workspaceOpenFailed: false,
      workspacePickerVisible: false
    };
    const window = {
      evaluate: vi.fn(async () => surface),
      locator: vi.fn((selector) => selector.includes("ready") ? ready : failed)
    };
    const output = [
      '[agent-host:init] {"stage":"create-session","outcome":"started","durationMs":0}',
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":8}'
    ].join("\n");

    await expect(waitForWindowsSyntheticRuntimeReady(window, () => output, 1.25, 30_000))
      .rejects.toThrow(/"runtimePhase":"starting"/u);
    await expect(inspectWindowsSyntheticRuntimeSurface(window)).resolves.toEqual(surface);
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
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).not.toThrow();
  });

  it("rejects covered controls and horizontal overflow", () => {
    expect(() => assertLayoutObservation({
      ...observation(),
      horizontalOverflow: 12,
      send: { contained: true, topmost: false, topmostSurface: "other" }
    }, {
      breakpoint: "context-drawer",
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).toThrow(/overflows horizontally/u);
  });

  it("distinguishes an unavailable control from clipping or coverage", () => {
    expect(() => assertLayoutObservation({
      ...observation(),
      send: null
    }, {
      breakpoint: "context-drawer",
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).toThrow(/Send is unavailable/u);
    expect(() => assertLayoutObservation({
      ...observation(),
      send: { contained: true, topmost: false, topmostSurface: "other" }
    }, {
      breakpoint: "context-drawer",
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).toThrow(/Send is covered/u);
  });

  it("accepts only the expected drawer as the foreground owner while open", () => {
    const drawerObservation = {
      ...observation(),
      send: { contained: true, topmost: false, topmostSurface: "context-drawer" },
      stop: { contained: true, topmost: false, topmostSurface: "context-drawer" }
    };
    expect(() => assertLayoutObservation(drawerObservation, {
      breakpoint: "context-drawer",
      expectedControlLayer: "context-drawer",
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).not.toThrow();
    expect(() => assertLayoutObservation({
      ...drawerObservation,
      stop: { contained: true, topmost: false, topmostSurface: "other" }
    }, {
      breakpoint: "context-drawer",
      expectedControlLayer: "context-drawer",
      expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      requestedScaleFactor: 1.5
    })).toThrow(/Stop expected context-drawer foreground, got other/u);
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
    composer: { bottom: 780, height: 140, left: 240, right: 1_130, top: 640, width: 890 },
    contextDrawerVisible: true,
    devicePixelRatio: 1.5,
    horizontalOverflow: 0,
    innerHeight: 800,
    innerWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
    matchesContextBreakpoint: true,
    matchesNavigationBreakpoint: false,
    navigationDrawerVisible: false,
    outerWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
    send: { contained: true, topmost: true, topmostSurface: "control" },
    stop: { contained: true, topmost: true, topmostSurface: "control" },
    titleBar: {
      bottom: 42,
      height: 42,
      left: 0,
      right: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      top: 0,
      width: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX
    },
    titleBarNativeControlReserve: 152,
    visualViewportHeight: 800,
    visualViewportWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX
  };
}
