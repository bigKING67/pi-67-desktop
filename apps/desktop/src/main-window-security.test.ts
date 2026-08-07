import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { installMainWindowSecurityPolicy } from "./main-window-security.js";

describe("main window security policy", () => {
  it("denies navigation, windows, downloads, webviews, devices, and non-write permissions", () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const sessionHandlers = new Map<string, (...args: never[]) => unknown>();
    const session = {
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => sessionHandlers.set(event, handler)),
      off: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn()
    };
    const webContents = {
      getURL: () => "app://pi67/index.html",
      isDestroyed: () => false,
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => handlers.set(event, handler)),
      off: vi.fn(),
      session,
      setWindowOpenHandler: vi.fn()
    } as unknown as WebContents;

    const dispose = installMainWindowSecurityPolicy(webContents, "app://pi67/index.html");
    expect((webContents.setWindowOpenHandler as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]()).toEqual({ action: "deny" });

    const preventNavigation = vi.fn();
    handlers.get("will-navigate")?.({ preventDefault: preventNavigation } as never, "https://example.invalid" as never);
    expect(preventNavigation).toHaveBeenCalledOnce();
    const allowExactLocation = vi.fn();
    handlers.get("will-navigate")?.({ preventDefault: allowExactLocation } as never, "app://pi67/index.html" as never);
    expect(allowExactLocation).not.toHaveBeenCalled();

    const preventWebview = vi.fn();
    handlers.get("will-attach-webview")?.({ preventDefault: preventWebview } as never);
    expect(preventWebview).toHaveBeenCalledOnce();
    const preventDownload = vi.fn();
    sessionHandlers.get("will-download")?.({ preventDefault: preventDownload } as never);
    expect(preventDownload).toHaveBeenCalledOnce();

    const permissionCheck = session.setPermissionCheckHandler.mock.calls[0]?.[0];
    expect(permissionCheck(webContents, "clipboard-sanitized-write", "app://pi67")).toBe(true);
    expect(permissionCheck(webContents, "clipboard-read", "app://pi67")).toBe(false);
    expect(permissionCheck(null, "clipboard-sanitized-write", "app://pi67")).toBe(false);
    expect(session.setDevicePermissionHandler.mock.calls[0]?.[0]({})).toBe(false);

    const permissionCallback = vi.fn();
    session.setPermissionRequestHandler.mock.calls[0]?.[0](webContents, "notifications", permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    dispose();
    expect(session.setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
    expect(session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
    expect(session.setDevicePermissionHandler).toHaveBeenLastCalledWith(null);
  });

  it("cleans up the captured session after web contents are destroyed", () => {
    let destroyed = false;
    const webContentsOff = vi.fn();
    const session = {
      on: vi.fn(),
      off: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn()
    };
    const webContents = {
      getURL: () => "app://pi67/index.html",
      isDestroyed: () => destroyed,
      on: vi.fn(),
      off: webContentsOff,
      get session() {
        if (destroyed) throw new Error("Object has been destroyed");
        return session;
      },
      setWindowOpenHandler: vi.fn()
    } as unknown as WebContents;

    const dispose = installMainWindowSecurityPolicy(webContents, "app://pi67/index.html");
    destroyed = true;

    expect(dispose).not.toThrow();
    expect(webContentsOff).not.toHaveBeenCalled();
    expect(session.off).toHaveBeenCalledWith("will-download", expect.any(Function));
    expect(session.setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
    expect(session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
    expect(session.setDevicePermissionHandler).toHaveBeenLastCalledWith(null);

    dispose();
    expect(session.off).toHaveBeenCalledTimes(1);
  });
});
