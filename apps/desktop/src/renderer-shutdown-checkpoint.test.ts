import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value: unknown) => unknown>(),
  handle: vi.fn(),
  removeHandler: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: mocks.handle,
    removeHandler: mocks.removeHandler
  }
}));

import { registerRendererShutdownCheckpoint } from "./renderer-shutdown-checkpoint.js";

describe("renderer shutdown checkpoint Main bridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.handlers.clear();
    mocks.handle.mockReset();
    mocks.removeHandler.mockReset();
    mocks.handle.mockImplementation((channel: string, handler: (event: unknown, value: unknown) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
  });

  it("waits for the exact active renderer acknowledgement", async () => {
    const send = vi.fn();
    const webContents = { isDestroyed: () => false, send };
    const window = {
      isDestroyed: () => false,
      webContents
    } as unknown as BrowserWindow;
    const registration = registerRendererShutdownCheckpoint({ getMainWindow: () => window });

    const request = registration.request();
    expect(send).toHaveBeenCalledWith(
      "pi67:renderer-shutdown-checkpoint-requested",
      { requestId: expect.any(String) }
    );
    const requestId = send.mock.calls[0]?.[1].requestId as string;
    const complete = mocks.handlers.get("pi67:renderer-shutdown-checkpoint-complete");
    expect(complete?.({ sender: {} }, { requestId, succeeded: true })).toBe(false);
    expect(complete?.({ sender: webContents }, { requestId: "stale", succeeded: true })).toBe(false);
    expect(complete?.({ sender: webContents }, { requestId, succeeded: true })).toBe(true);
    await expect(request).resolves.toBe(true);

    registration.dispose();
    expect(mocks.removeHandler).toHaveBeenCalledWith("pi67:renderer-shutdown-checkpoint-complete");
  });

  it("fails closed when the renderer does not answer before the deadline", async () => {
    vi.useFakeTimers();
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() }
    } as unknown as BrowserWindow;
    const registration = registerRendererShutdownCheckpoint({
      getMainWindow: () => window,
      timeoutMs: 100
    });

    const request = registration.request();
    await vi.advanceTimersByTimeAsync(100);
    await expect(request).resolves.toBe(false);
    registration.dispose();
  });
});
