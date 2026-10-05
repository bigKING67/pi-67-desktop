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
  windowsUiScenarioMatrix,
  WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
  WINDOWS_SYNTHETIC_SCALE_FACTORS,
  WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS
} from "./verify-windows-packaged-input-layout.mjs";

vi.mock("./controlled-provider-interaction.mjs", () => ({ startControlledPrompt: vi.fn(async () => undefined) }));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Windows packaged synthetic-scale UI contract", () => {
  it("keeps the release scale matrix explicit", () => {
    expect(WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX).toBe(1_320);
    expect(WINDOWS_SYNTHETIC_SCALE_FACTORS).toEqual([1.25, 1.5, 2]);
    expect(WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS).toBe(60_000);
    expect(WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS).toBe(5_000);
  });

  it("keeps ordinary coverage unchanged and bounds opt-in diagnostic repetitions", () => {
    const first = WINDOWS_SYNTHETIC_SCALE_FACTORS.map(scaleFactor => ({ scaleFactor, verificationRound: 1 }));
    expect(windowsUiScenarioMatrix()).toEqual(first);
    expect(windowsUiScenarioMatrix(3)).toEqual([1, 2, 3].flatMap(verificationRound =>
      WINDOWS_SYNTHETIC_SCALE_FACTORS.map(scaleFactor => ({ scaleFactor, verificationRound }))));
    for (const invalid of [0, 2, 4, -1, 1.5, NaN, "3"]) {
      expect(() => windowsUiScenarioMatrix(invalid)).toThrow("Windows UI rounds must be 1 or 3");
    }
  });

  it.each([false, true])("waits for a Session surface before the first prompt, intent=%s", async (intentVisible) => {
    const fixture = sessionSurfaceFixture({ intentVisible });
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 1.5, 12_345))
      .resolves.toBe(intentVisible ? "new-session-intent" : "runtime-ready");
    expect(fixture.waitFor).toHaveBeenCalledOnce();
    expect(fixture.waitFor.mock.calls[0][0]).toMatchObject({ state: "visible" });
    expect(fixture.waitFor.mock.calls[0][0].timeout).toBeLessThanOrEqual(12_345);
    expect(fixture.click).not.toHaveBeenCalled();
    expect(startControlledPrompt).toHaveBeenCalledExactlyOnceWith(fixture.window);
  });

  it("explicitly creates one Intent only from an authoritative ready-empty Workspace", async () => {
    const fixture = sessionSurfaceFixture({ emptyVisible: true });
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 2))
      .resolves.toBe("ready-empty-workspace");
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.intentWaitFor).toHaveBeenCalledOnce();
    expect(startControlledPrompt).toHaveBeenCalledExactlyOnceWith(fixture.window);
    const selector = fixture.window.locator.mock.calls.find(([value]) => value.startsWith(".application-shell"))[0];
    for (const required of [
      '[data-agent-connected="true"]', '[data-workspace-open-pending="false"]',
      '[data-runtime-phase="stopped"]', '[data-catalog-state="ready"]',
      '[data-catalog-loading="false"]', '[data-catalog-rebuilding="false"]',
      '[data-catalog-incomplete="false"]', '[data-catalog-error="false"]', '[data-catalog-item-count="0"]'
    ]) expect(selector).toContain(required);
  });

  it("keeps the empty Workspace action and Intent wait inside the original deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fixture = sessionSurfaceFixture({ emptyVisible: true });
    fixture.waitFor.mockImplementation(async () => { now = 8_000; });
    fixture.click.mockImplementation(async () => { now = 9_000; });
    await startWindowsSyntheticControlledOperation(fixture.window, () => "", 2, 10_000);
    expect(fixture.click).toHaveBeenCalledWith({ timeout: 2_000 });
    expect(fixture.intentWaitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1_000 });
  });

  it("does not submit if the explicit New action consumes the remaining deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fixture = sessionSurfaceFixture({ emptyVisible: true });
    fixture.click.mockImplementation(async () => { now = 10_000; });
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 2, 10_000))
      .rejects.toThrow(/Session surface deadline exceeded/u);
    expect(fixture.intentWaitFor).not.toHaveBeenCalled();
    expect(startControlledPrompt).not.toHaveBeenCalled();
  });

  it("reports bounded runtime and initialization diagnostics without admitting an unknown Catalog", async () => {
    const fixture = sessionSurfaceFixture();
    fixture.waitFor.mockRejectedValue(new Error("timeout"));
    const surface = { runtimePhase: "stopped", catalog: { state: "unavailable" } };
    fixture.window.evaluate.mockResolvedValue(surface);
    const output = '[agent-host:init] {"stage":"create-session","outcome":"started","durationMs":0}';
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => output, 2, 30_000))
      .rejects.toThrow('"catalog":{"state":"unavailable"}');
    expect(fixture.click).not.toHaveBeenCalled();
    expect(startControlledPrompt).not.toHaveBeenCalled();
    await expect(inspectWindowsSyntheticRuntimeSurface(fixture.window)).resolves.toEqual(surface);
  });

  it.each([false, true])("rejects an explicit failed Runtime before New or Prompt, empty=%s", async (emptyVisible) => {
    const fixture = sessionSurfaceFixture({ emptyVisible, intentVisible: true, failed: true });
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 1.5))
      .rejects.toMatchObject({ cause: { message: "Pi SDK entered the failed runtime phase." } });
    expect(fixture.click).not.toHaveBeenCalled();
    expect(startControlledPrompt).not.toHaveBeenCalled();
  });

  it("does not submit if Runtime fails after the explicit New action", async () => {
    const fixture = sessionSurfaceFixture({ emptyVisible: true });
    fixture.failed.isVisible.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 2))
      .rejects.toMatchObject({ cause: { message: "Pi SDK entered the failed runtime phase." } });
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(startControlledPrompt).not.toHaveBeenCalled();
  });

  it("cannot pass an Intent whose controlled model or Prompt fails to initialize", async () => {
    const fixture = sessionSurfaceFixture({ intentVisible: true });
    const failure = new Error("Controlled model did not hydrate");
    vi.mocked(startControlledPrompt).mockRejectedValueOnce(failure);
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 1.5))
      .rejects.toMatchObject({ cause: failure, message: expect.stringContaining('"stage":"controlled-prompt"') });
    expect(startControlledPrompt).toHaveBeenCalledExactlyOnceWith(fixture.window);
  });

  it("preserves a Prompt failure when the renderer is already unavailable", async () => {
    const fixture = sessionSurfaceFixture({ intentVisible: true });
    fixture.window.evaluate.mockRejectedValue(new Error("page closed"));
    const failure = new Error("Stop never appeared");
    vi.mocked(startControlledPrompt).mockRejectedValueOnce(failure);
    await expect(startWindowsSyntheticControlledOperation(fixture.window, () => "", 1.5))
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

function sessionSurfaceFixture({ intentVisible = false, emptyVisible = false, failed: runtimeFailed = false } = {}) {
  const waitFor = vi.fn(async () => undefined);
  const intentWaitFor = vi.fn(async () => undefined);
  const click = vi.fn(async () => undefined);
  const combined = { or: vi.fn(), first: () => ({ waitFor }) };
  combined.or.mockReturnValue(combined);
  const failed = { isVisible: vi.fn(async () => runtimeFailed) };
  const intent = {
    isVisible: vi.fn(async () => intentVisible),
    or: vi.fn(() => ({ first: () => ({ waitFor: intentWaitFor }) }))
  };
  const empty = { isVisible: vi.fn(async () => emptyVisible), click };
  const window = {
    locator: vi.fn(selector => selector.startsWith(".application-shell")
      ? { getByRole: vi.fn(() => empty) }
      : selector.includes("ready") ? combined : failed),
    getByTestId: vi.fn(() => intent),
    evaluate: vi.fn(async () => ({ runtimePhase: "stopped" }))
  };
  return { window, waitFor, intentWaitFor, click, failed };
}
