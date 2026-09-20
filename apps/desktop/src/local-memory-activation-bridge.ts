import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { isLocalMemoryActivationSnapshot, isLocalMemoryHealthCheck, parseLocalMemoryActivationRequest } from "@pi67/protocol";
import type { LocalMemoryActivationController } from "./local-memory-activation-controller.js";
import { isExpectedRendererLocation, PACKAGED_RENDERER_URL } from "./renderer-security.js";

export function registerLocalMemoryActivationBridge(
  getWindow: () => BrowserWindow | undefined,
  getController: () => LocalMemoryActivationController | undefined,
  rendererUrl = PACKAGED_RENDERER_URL
) {
  let disposed = false;
  function authorize(event: IpcMainInvokeEvent) {
    const window = getWindow();
    if (disposed || !window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame || !isExpectedRendererLocation(event.senderFrame.url, rendererUrl)) {
      throw new Error("Memory activation sender is not authorized.");
    }
  }
  function checked(value: unknown) {
    if (!isLocalMemoryActivationSnapshot(value)) throw new Error("Invalid activation snapshot.");
    return value;
  }
  ipcMain.handle("pi67:local-memory-activation-get", (event, ...args: unknown[]) => {
    authorize(event);
    if (args.length) throw new Error("Invalid memory activation arguments.");
    return checked(getController()?.get() ?? { available: false });
  });
  ipcMain.handle("pi67:local-memory-activation-set", async (event, ...args: unknown[]) => {
    authorize(event);
    const request = args.length === 1 ? parseLocalMemoryActivationRequest(args[0]) : undefined;
    if (!request) throw new Error("Invalid memory activation arguments.");
    try {
      const controller = getController();
      if (!controller) return { available: false };
      const result = await controller.setEnabled(request.enabled);
      authorize(event);
      return checked(result);
    } catch { throw new Error("Memory activation could not be changed. Refresh its status before retrying."); }
  });
  ipcMain.handle("pi67:local-memory-activation-check", async (event, ...args: unknown[]) => {
    authorize(event);
    if (args.length) throw new Error("Invalid memory health arguments.");
    try {
      const value = await getController()?.check() ?? { activation: { available: false }, health: "not-running" };
      authorize(event);
      if (!isLocalMemoryHealthCheck(value)) throw new Error("Invalid memory health response.");
      return value;
    } catch { throw new Error("Private memory health could not be checked. Refresh its status before retrying."); }
  });
  return () => {
    disposed = true;
    ipcMain.removeHandler("pi67:local-memory-activation-get");
    ipcMain.removeHandler("pi67:local-memory-activation-set");
    ipcMain.removeHandler("pi67:local-memory-activation-check");
  };
}
