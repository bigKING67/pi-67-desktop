import { afterEach, describe, expect, it, vi } from "vitest";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import {
  inspectWindowsSyntheticRuntimeSurface,
  startWindowsSyntheticControlledOperation,
  WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS
} from "./windows-synthetic-session-activation.mjs";
import {
  assertContextPanelActivation,
  assertLayoutObservation,
  locateTaskInspector,
  prepareResponsiveLayoutControls,
  viewportWidthMatches,
  WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
  WINDOWS_SYNTHETIC_SCALE_FACTORS,
  WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS
} from "./verify-windows-packaged-input-layout.mjs";

vi.mock("./controlled-provider-interaction.mjs", () => ({ startControlledPrompt: vi.fn(async () => undefined) }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("Windows packaged synthetic-scale UI contract", () => {
  it("keeps the release scale matrix explicit", () => {
    expect(WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX).toBe(1_320);
    expect(WINDOWS_SYNTHETIC_SCALE_FACTORS).toEqual([1.25, 1.5, 2]);
    expect(WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS).toBe(60_000);
    expect(WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS).toBe(5_000);
  });

  it.each([false, true])("waits for a Session surface before the first prompt, intent=%s", async (intentVisible) => {
    const waitFor = vi.fn();
    const isVisible = vi.fn(async () => false);
    const failed = { isVisible };
    const intent = { isVisible: vi.fn(async () => intentVisible) };
    const combined = { first: vi.fn(() => ({ waitFor })), or: vi.fn() };
    combined.or.mockReturnValue(combined);
    const ready = { or: vi.fn(() => combined) };
    const window = {
      getByTestId: vi.fn(() => intent),
      locator: vi.fn((selector) => selector.includes("ready") ? ready : failed)
    };

    await expect(startWindowsSyntheticControlledOperation(window, () => "", 1.5, 12_345))
      .resolves.toBe(intentVisible ? "new-session-intent" : "runtime-ready");

    expect(ready.or).toHaveBeenCalledWith(failed);
    expect(combined.or).toHaveBeenCalledWith(intent);
    expect(window.getByTestId).toHaveBeenCalledWith("new-session-intent");
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 12_345 });
    expect(isVisible).toHaveBeenCalledOnce();
    expect(startControlledPrompt).toHaveBeenCalledExactlyOnceWith(window);
  });

  it("reports bounded runtime and initialization diagnostics on failure", async () => {
    const waitFor = vi.fn(async () => {
      throw new Error("timeout");
    });
    const failed = { isVisible: vi.fn(async () => false) };
    const combined = { first: vi.fn(() => ({ waitFor })), or: vi.fn() };
    combined.or.mockReturnValue(combined);
    const ready = { or: vi.fn(() => combined) };
    const surface = {
      acknowledgementTimedOut: false,
      conversationRowCount: 0,
      newSessionIntentVisible: false,
      runtimePhase: "stopped",
      title: "New Money",
      url: "app://pi67/index.html",
      workspaceOpenFailed: false,
      workspacePickerVisible: false
    };
    const window = {
      evaluate: vi.fn(async () => surface),
      getByTestId: vi.fn(),
      locator: vi.fn((selector) => selector.includes("ready") ? ready : failed)
    };
    const output = [
      '[agent-host:init] {"stage":"create-session","outcome":"started","durationMs":0}',
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":8}'
    ].join("\n");

    await expect(startWindowsSyntheticControlledOperation(window, () => output, 1.25, 30_000))
      .rejects.toThrow(/"runtimePhase":"stopped"/u);
    expect(startControlledPrompt).not.toHaveBeenCalled();
    await expect(inspectWindowsSyntheticRuntimeSurface(window)).resolves.toEqual(surface);
  });

  it("rejects an explicit failed Runtime even alongside a visible intent", async () => {
    const combined = { or: vi.fn(), first: () => ({ waitFor: vi.fn() }) };
    combined.or.mockReturnValue(combined);
    const failed = { isVisible: vi.fn(async () => true) };
    const window = {
      locator: vi.fn(selector => selector.includes("ready") ? combined : failed),
      getByTestId: vi.fn(() => ({ isVisible: vi.fn(async () => true) })),
      evaluate: vi.fn(async () => ({ runtimePhase: "failed", newSessionIntentVisible: true }))
    };
    await expect(startWindowsSyntheticControlledOperation(window, () => "", 1.5))
      .rejects.toMatchObject({ cause: { message: "Pi SDK entered the failed runtime phase." } });
    expect(startControlledPrompt).not.toHaveBeenCalled();
  });

  it("cannot pass an intent whose controlled model or prompt fails to initialize", async () => {
    const combined = { or: vi.fn(), first: () => ({ waitFor: vi.fn() }) };
    combined.or.mockReturnValue(combined);
    const failed = { isVisible: vi.fn(async () => false) };
    const window = {
      locator: vi.fn(selector => selector.includes("ready") ? combined : failed),
      getByTestId: vi.fn(() => ({ isVisible: vi.fn(async () => true) })),
      evaluate: vi.fn(async () => ({ runtimePhase: "ready", firstPromptNotSent: true }))
    };
    const failure = new Error("Controlled model did not hydrate");
    vi.mocked(startControlledPrompt).mockRejectedValueOnce(failure);
    await expect(startWindowsSyntheticControlledOperation(window, () => "", 1.5))
      .rejects.toMatchObject({ cause: failure, message: expect.stringContaining('"stage":"controlled-prompt"') });
    expect(startControlledPrompt).toHaveBeenCalledExactlyOnceWith(window);
    expect(window.evaluate).toHaveBeenCalledOnce();
  });

  it("preserves a prompt failure when the renderer is already unavailable", async () => {
    const combined = { or: vi.fn(), first: () => ({ waitFor: vi.fn() }) };
    combined.or.mockReturnValue(combined);
    const window = {
      locator: vi.fn(selector => selector.includes("ready") ? combined : { isVisible: async () => false }),
      getByTestId: vi.fn(() => ({ isVisible: async () => true })),
      evaluate: vi.fn(async () => { throw new Error("page closed"); })
    };
    const failure = new Error("Stop never appeared");
    vi.mocked(startControlledPrompt).mockRejectedValueOnce(failure);
    await expect(startWindowsSyntheticControlledOperation(window, () => "", 1.5))
      .rejects.toMatchObject({ cause: failure, message: expect.stringContaining('"surface":{"unavailable":true}') });
  });

  it("bounds surface evidence when a stalled renderer never answers", async () => {
    vi.useFakeTimers();
    const window = { evaluate: vi.fn(() => new Promise(() => {})) };
    const observation = inspectWindowsSyntheticRuntimeSurface(window);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(observation).resolves.toEqual({ unavailable: true });
    expect(vi.getTimerCount()).toBe(0);
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

  it("accepts drawer fallback and docked activation after a safe native expansion", () => {
    const drawer = {
      ...observation(),
      contextDrawerMode: true,
      send: { contained: true, topmost: false, topmostSurface: "context-drawer" },
      stop: { contained: true, topmost: false, topmostSurface: "context-drawer" }
    };
    expect(assertContextPanelActivation(drawer, 1.5)).toBe("drawer");

    const expandedWidth = WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX + 1;
    const expanded = {
      ...observation(),
      innerWidth: expandedWidth,
      matchesContextBreakpoint: false,
      outerWidth: expandedWidth,
      titleBar: { bottom: 42, height: 42, left: 0, right: expandedWidth, top: 0, width: expandedWidth },
      visualViewportWidth: expandedWidth
    };
    expect(assertContextPanelActivation(expanded, 1.5)).toBe("docked-after-expansion");
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
    contextDrawerMode: false,
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
