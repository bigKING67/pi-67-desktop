import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizedRendererSender } from "./authorized-ipc.test-support.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn()
}));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.ipcHandle } }));

const { createAuthorizedIpcHandle, isAuthorizedRendererSender } = await import("./authorized-ipc.js");

describe("authorized IPC", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
  });

  it("accepts only the live main window's main frame at the renderer URL", () => {
    const { window, event } = authorizedRendererSender();
    const url = "app://pi67/index.html";
    expect(isAuthorizedRendererSender(event, window, url)).toBe(true);
    expect(isAuthorizedRendererSender(event, undefined, url)).toBe(false);
    const destroyed = { isDestroyed: () => true, webContents: window.webContents } as unknown as BrowserWindow;
    expect(isAuthorizedRendererSender(event, destroyed, url)).toBe(false);
    const other = authorizedRendererSender();
    expect(isAuthorizedRendererSender(other.event, window, url)).toBe(false);
    const subframe = { ...event, senderFrame: { url } } as unknown as IpcMainInvokeEvent;
    expect(isAuthorizedRendererSender(subframe, window, url)).toBe(false);
    const navigated = authorizedRendererSender("https://attacker.example/");
    expect(isAuthorizedRendererSender(navigated.event, navigated.window, url)).toBe(false);
  });

  it("rejects an unauthorized sender before the listener runs", async () => {
    const { window, event } = authorizedRendererSender();
    const listener = vi.fn(() => "ok");
    createAuthorizedIpcHandle(() => window)("pi67:example", listener);
    const handler = mocks.handlers.get("pi67:example")!;

    await expect(Promise.resolve().then(() => handler(authorizedRendererSender().event, 1))).rejects.toThrow("not authorized");
    expect(listener).not.toHaveBeenCalled();
    expect(handler(event, 1)).toBe("ok");
    expect(listener).toHaveBeenCalledWith(event, 1);
  });
});
