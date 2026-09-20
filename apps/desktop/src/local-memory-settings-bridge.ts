import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { LocalMemorySettingsController } from "./local-memory-settings-controller.js";
import { isLocalMemorySettingsSnapshot } from "@pi67/protocol";
import { isExpectedRendererLocation, PACKAGED_RENDERER_URL } from "./renderer-security.js";

export function registerLocalMemorySettingsBridge(
  getWindow: () => BrowserWindow | undefined,
  getController: () => LocalMemorySettingsController | undefined,
  rendererUrl = PACKAGED_RENDERER_URL
): () => void {
  function authorize(event: IpcMainInvokeEvent) {
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame || !isExpectedRendererLocation(event.senderFrame.url, rendererUrl)) {
      throw new Error("Memory settings sender is not authorized.");
    }
  }
  function checked(value: unknown) {
    if (!isLocalMemorySettingsSnapshot(value)) throw new Error("Invalid settings projection.");
    return value;
  }
  ipcMain.handle("pi67:local-memory-settings-get", async (event) => {
    authorize(event);
    try { return checked(await getController()?.get() ?? { status: "unavailable" }); }
    catch { throw new Error("Memory settings are unavailable."); }
  });
  ipcMain.handle("pi67:local-memory-settings-save", async (event, value: unknown) => {
    authorize(event);
    try {
      const controller = getController();
      if (!controller) throw new Error("Unavailable");
      return checked(await controller.save(value));
    } catch { throw new Error("Memory settings could not be saved. Check configuration and secure storage."); }
  });
  ipcMain.handle("pi67:local-memory-settings-reveal-key", async (event, value: unknown) => {
    authorize(event);
    try {
      const controller = getController();
      if (!controller) throw new Error("Unavailable");
      const key = await controller.revealKey(value);
      authorize(event); // Do not deliver a late secret to a replaced/navigated document.
      if (typeof key !== "string" || !key.trim() || key.length > 4096 || key.includes("\0")) throw new Error("Invalid key");
      return key;
    } catch { throw new Error("Saved memory key could not be revealed."); }
  });
  return () => {
    ipcMain.removeHandler("pi67:local-memory-settings-get");
    ipcMain.removeHandler("pi67:local-memory-settings-save");
    ipcMain.removeHandler("pi67:local-memory-settings-reveal-key");
  };
}
