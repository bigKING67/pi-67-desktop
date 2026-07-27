import { join } from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import { isExpectedRendererLocation } from "./renderer-security.js";
import { titleBarOverlay } from "./title-bar-overlay.js";

interface CreateMainWindowOptions {
  currentDirectory: string;
  isPackaged: boolean;
  rendererUrl: string;
  onDidFinishLoad: (window: BrowserWindow) => void;
  onClosed: (window: BrowserWindow) => void;
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    title: "Pi-67 Desktop",
    width: 1440,
    height: 920,
    minWidth: 680,
    minHeight: 600,
    show: false,
    backgroundColor: "#111412",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? {} : {
      titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors)
    }),
    webPreferences: {
      preload: join(options.currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !options.isPackaged
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isExpectedRendererLocation(target, options.rendererUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (!isExpectedRendererLocation(target, options.rendererUrl)) event.preventDefault();
  });
  window.webContents.on("did-finish-load", () => options.onDidFinishLoad(window));
  window.once("ready-to-show", () => window.show());

  const updateTitleBar = () => window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
  nativeTheme.on("updated", updateTitleBar);
  window.on("closed", () => {
    nativeTheme.off("updated", updateTitleBar);
    options.onClosed(window);
  });
  return window;
}
