import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  const windows: EventEmitter[] = [];
  return {
    windows,
    nativeTheme: Object.assign(new Emitter(), { shouldUseDarkColors: false }),
    BrowserWindow: function BrowserWindow() {
      const window = Object.assign(new Emitter(), {
        webContents: new Emitter(),
        show: () => undefined,
        ...(process.platform === "darwin" ? {} : { setTitleBarOverlay: vi.fn() })
      });
      windows.push(window);
      return window;
    }
  };
});
vi.mock("./main-window-security.js", () => ({ installMainWindowSecurityPolicy: () => () => undefined }));
import * as electron from "electron";
import { createMainWindow } from "./main-window.js";

const mocked = electron as unknown as {
  nativeTheme: EventEmitter;
  windows: Array<EventEmitter & { setTitleBarOverlay?: ReturnType<typeof vi.fn> }>;
};
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function create() {
  createMainWindow({
    currentDirectory: "/app",
    isPackaged: true,
    rendererUrl: "app://pi67/index.html",
    onDidFinishLoad: () => undefined,
    onClosed: () => undefined
  });
  return mocked.windows.at(-1)!;
}

describe("main window title bar", () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    mocked.nativeTheme.removeAllListeners();
    mocked.windows.length = 0;
  });

  it("does not call the Windows/Linux-only overlay API when macOS appearance changes", () => {
    setPlatform("darwin");
    create();
    expect(mocked.nativeTheme.listenerCount("updated")).toBe(0);
    expect(() => mocked.nativeTheme.emit("updated")).not.toThrow();
  });

  it("refreshes the caption overlay on Windows and detaches when the window closes", () => {
    setPlatform("win32");
    const window = create();
    mocked.nativeTheme.emit("updated");
    expect(window.setTitleBarOverlay).toHaveBeenCalledTimes(1);
    window.emit("closed");
    expect(mocked.nativeTheme.listenerCount("updated")).toBe(0);
  });
});
