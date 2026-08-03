import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATIC_UPDATE_INTERVAL_MS,
  AUTOMATIC_UPDATE_STARTUP_DELAY_MS,
  ManualUpdateController
} from "./manual-update-controller.js";
import type { UnsignedPreviewUpdateResult } from "./manual-update.js";

describe("ManualUpdateController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps development builds offline", async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const publish = vi.fn();
    const controller = new ManualUpdateController({
      currentVersion: "0.1.0-alpha.1",
      packaged: false,
      fetcher: vi.fn(),
      publish,
      check
    });

    controller.startAutomaticChecks();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_STARTUP_DELAY_MS);

    expect(controller.getState()).toEqual({
      phase: "disabled",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      detail: "Development build",
      automaticChecks: false
    });
    expect(await controller.checkNow()).toBe(controller.getState());
    expect(check).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("checks after startup and at most once per daily interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T08:00:00.000Z"));
    const publish = vi.fn();
    const check = vi.fn(async (): Promise<UnsignedPreviewUpdateResult> => ({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2"
    }));
    const controller = new ManualUpdateController({
      currentVersion: "0.1.0-alpha.1",
      packaged: true,
      fetcher: vi.fn(),
      publish,
      check
    });

    controller.startAutomaticChecks();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_STARTUP_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(check).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
      automaticChecks: true,
      checkedAt: "2026-08-03T08:00:10.000Z"
    });

    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("deduplicates overlapping automatic and manual checks", async () => {
    let resolveCheck: ((state: UnsignedPreviewUpdateResult) => void) | undefined;
    const check = vi.fn(() => new Promise<UnsignedPreviewUpdateResult>((resolve) => {
      resolveCheck = resolve;
    }));
    const controller = new ManualUpdateController({
      currentVersion: "0.1.0-alpha.1",
      packaged: true,
      fetcher: vi.fn(),
      publish: vi.fn(),
      check
    });

    const first = controller.checkNow();
    const second = controller.checkNow();
    expect(check).toHaveBeenCalledOnce();

    resolveCheck?.({
      phase: "current",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1"
    });
    expect(await first).toEqual(await second);
  });

  it("does not repeat a recent manual check when the startup timer fires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T08:00:00.000Z"));
    const check = vi.fn(async (): Promise<UnsignedPreviewUpdateResult> => ({
      phase: "current",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1"
    }));
    const controller = new ManualUpdateController({
      currentVersion: "0.1.0-alpha.1",
      packaged: true,
      fetcher: vi.fn(),
      publish: vi.fn(),
      check
    });

    controller.startAutomaticChecks();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_STARTUP_DELAY_MS / 2);
    await controller.checkNow();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_STARTUP_DELAY_MS / 2);

    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_UPDATE_INTERVAL_MS - (AUTOMATIC_UPDATE_STARTUP_DELAY_MS / 2) - 1
    );
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("converts check failures into bounded observable state", async () => {
    const publish = vi.fn();
    const controller = new ManualUpdateController({
      currentVersion: "0.1.0-alpha.1",
      packaged: true,
      fetcher: vi.fn(),
      publish,
      check: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      sanitizeError: () => "network unavailable"
    });

    await expect(controller.checkNow()).resolves.toMatchObject({
      phase: "error",
      detail: "network unavailable",
      automaticChecks: true
    });
    expect(publish).toHaveBeenCalledOnce();
  });
});
