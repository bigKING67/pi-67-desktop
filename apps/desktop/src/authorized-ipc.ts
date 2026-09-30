import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { isExpectedRendererLocation, PACKAGED_RENDERER_URL } from "./renderer-security.js";

/** An IPC request is authorized only from the live main window's main frame at the renderer URL. */
export function isAuthorizedRendererSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | undefined,
  rendererUrl: string
): boolean {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame && event.senderFrame === window.webContents.mainFrame
    && isExpectedRendererLocation(event.senderFrame.url, rendererUrl));
}

export type AuthorizedIpcHandle = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) => unknown
) => void;

/** Registers invoke handlers that reject any sender other than the main renderer before running. */
export function createAuthorizedIpcHandle(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl = PACKAGED_RENDERER_URL
): AuthorizedIpcHandle {
  return (channel, listener) => ipcMain.handle(channel, (event, ...arguments_: unknown[]) => {
    if (!isAuthorizedRendererSender(event, getWindow(), rendererUrl)) {
      throw new Error("IPC sender is not authorized.");
    }
    return listener(event, ...arguments_);
  });
}
