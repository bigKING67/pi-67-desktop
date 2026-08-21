import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATIC_UPDATE_INTERVAL_MS,
  AUTOMATIC_UPDATE_STARTUP_DELAY_MS,
  DesktopUpdateController
} from "./desktop-update-controller.js";
import type {
  CheckedUnsignedPreviewUpdate,
  TrustedUpdateArtifact
} from "./unsigned-preview-update.js";

describe("DesktopUpdateController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps development builds offline", async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const publish = vi.fn();
    const controller = createController({ packaged: false, check, publish });

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
    expect(await controller.startUpdate()).toBe(controller.getState());
    expect(check).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("checks after startup and at most once per daily interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T08:00:00.000Z"));
    const publish = vi.fn();
    const check = vi.fn(async (): Promise<CheckedUnsignedPreviewUpdate> => availableCheck());
    const controller = createController({ check, publish });

    controller.startAutomaticChecks();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_STARTUP_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(check).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: "available",
      version: "0.1.0-alpha.2",
      automaticChecks: true,
      checkedAt: "2026-08-20T08:00:10.000Z"
    }));

    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("deduplicates overlapping checks", async () => {
    let resolveCheck: ((checked: CheckedUnsignedPreviewUpdate) => void) | undefined;
    const check = vi.fn(() => new Promise<CheckedUnsignedPreviewUpdate>((resolve) => {
      resolveCheck = resolve;
    }));
    const controller = createController({ check });

    const first = controller.checkNow();
    const second = controller.checkNow();
    expect(check).toHaveBeenCalledOnce();
    resolveCheck?.(availableCheck());
    expect(await first).toEqual(await second);
  });

  it("does not start a stale verified artifact while a replacement check is pending", async () => {
    let resolveReplacement: ((checked: CheckedUnsignedPreviewUpdate) => void) | undefined;
    const check = vi.fn()
      .mockResolvedValueOnce(availableCheck())
      .mockImplementationOnce(() => new Promise<CheckedUnsignedPreviewUpdate>((resolve) => {
        resolveReplacement = resolve;
      }));
    const download = vi.fn();
    const controller = createController({ check, download });
    await controller.checkNow();

    const replacement = controller.checkNow();
    expect(controller.getState().phase).toBe("checking");
    await expect(controller.startUpdate()).resolves.toMatchObject({ phase: "checking" });
    expect(download).not.toHaveBeenCalled();

    resolveReplacement?.(availableCheck());
    await replacement;
    expect(controller.getState().phase).toBe("available");
  });

  it("downloads once, publishes bounded progress, verifies, and starts installation", async () => {
    const publish = vi.fn();
    const download = vi.fn(async (options: Parameters<NonNullable<ConstructorOptions["download"]>>[0]) => {
      options.onProgress({ transferred: 500, total: 1_000, percent: 50 });
      options.onProgress({ transferred: 1_000, total: 1_000, percent: 100 });
      return { path: "/tmp/verified-update.exe", artifact: options.artifact };
    });
    const install = vi.fn(async () => undefined);
    const controller = createController({ publish, download, install });
    await controller.checkNow();

    const first = controller.startUpdate();
    const second = controller.startUpdate();
    expect(await first).toEqual(await second);

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(expect.objectContaining({
      platform: "win32",
      version: "0.1.0-alpha.2",
      downloadPath: "/tmp/verified-update.exe"
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      phase: "downloading",
      transferred: 500,
      percent: 50
    }));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "installing" }));
  });

  it("cancels an active download and returns to the verified available state", async () => {
    let rejectDownload: ((error: unknown) => void) | undefined;
    const download = vi.fn((options: Parameters<NonNullable<ConstructorOptions["download"]>>[0]) => (
      new Promise<never>((_resolve, reject) => {
        rejectDownload = reject;
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      })
    ));
    const controller = createController({ download });
    await controller.checkNow();

    const pending = controller.startUpdate();
    expect(controller.getState().phase).toBe("downloading");
    const cancelled = controller.cancelUpdate();
    rejectDownload?.(new DOMException("cancelled", "AbortError"));

    await expect(cancelled).resolves.toMatchObject({
      phase: "available",
      version: "0.1.0-alpha.2"
    });
    await expect(pending).resolves.toMatchObject({ phase: "available" });
  });

  it("converts check and install failures into bounded observable state", async () => {
    const checkFailure = createController({
      check: vi.fn(async () => { throw new Error("network unavailable"); }),
      sanitizeError: () => "network unavailable"
    });
    await expect(checkFailure.checkNow()).resolves.toMatchObject({
      phase: "error",
      detail: "network unavailable"
    });

    const installFailure = createController({
      download: vi.fn(async (options) => ({ path: "/tmp/update.exe", artifact: options.artifact })),
      install: vi.fn(async () => { throw new Error("installer unavailable"); }),
      sanitizeError: (error) => error instanceof Error ? error.message : String(error)
    });
    await installFailure.checkNow();
    await expect(installFailure.startUpdate()).resolves.toMatchObject({
      phase: "error",
      detail: "installer unavailable"
    });
  });
});

type ConstructorOptions = ConstructorParameters<typeof DesktopUpdateController>[0];

function createController(overrides: Partial<ConstructorOptions> = {}): DesktopUpdateController {
  return new DesktopUpdateController({
    currentVersion: "0.1.0-alpha.1",
    packaged: true,
    platform: "win32",
    updateDirectory: "/tmp/pi67-updates",
    executablePath: "/opt/pi67/Pi-67 Desktop.exe",
    processId: 42,
    fetcher: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
    check: vi.fn(async () => availableCheck()),
    download: vi.fn(),
    install: vi.fn(),
    ...overrides
  });
}

function availableCheck(): CheckedUnsignedPreviewUpdate {
  return {
    state: {
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      artifactName: artifact.name,
      artifactBytes: artifact.bytes
    },
    artifact
  };
}

const artifact: TrustedUpdateArtifact = {
  name: "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe",
  bytes: 1_000,
  sha256: "a".repeat(64),
  target: "windows-x64",
  url: "https://updates.52671314.xyz/Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe"
};
