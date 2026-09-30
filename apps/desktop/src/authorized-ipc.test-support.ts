import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { PACKAGED_RENDERER_URL } from "./renderer-security.js";

/** A main window and an invoke event from its main frame that `isAuthorizedRendererSender` accepts. */
export function authorizedRendererSender(url = PACKAGED_RENDERER_URL): {
  window: BrowserWindow;
  event: IpcMainInvokeEvent;
} {
  const mainFrame = { url };
  const webContents = { mainFrame, isDestroyed: () => false };
  return {
    window: { isDestroyed: () => false, webContents } as unknown as BrowserWindow,
    event: { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  };
}
