import type { WebContents } from "electron";
import {
  isExpectedRendererLocation,
  rendererOrigin
} from "./renderer-security.js";

export function installMainWindowSecurityPolicy(webContents: WebContents, rendererUrl: string): () => void {
  const expectedOrigin = rendererOrigin(rendererUrl);
  const secureSession = webContents.session;
  let disposed = false;
  const isTrustedClipboardWriter = (requester: WebContents | null, permission: string, origin?: string) => (
    requester === webContents
    && permission === "clipboard-sanitized-write"
    && isExpectedRendererLocation(webContents.getURL(), rendererUrl)
    && (origin === undefined || origin === expectedOrigin)
  );
  const onNavigate = (event: Electron.Event, target: string) => {
    if (!isExpectedRendererLocation(target, rendererUrl)) event.preventDefault();
  };
  const onWillAttachWebview = (event: Electron.Event) => event.preventDefault();
  const onWillDownload = (event: Electron.Event) => event.preventDefault();

  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", onNavigate);
  webContents.on("will-redirect", onNavigate);
  webContents.on("will-attach-webview", onWillAttachWebview);
  secureSession.on("will-download", onWillDownload);
  secureSession.setPermissionCheckHandler((requester, permission, origin) => (
    isTrustedClipboardWriter(requester, permission, origin)
  ));
  secureSession.setPermissionRequestHandler((requester, permission, callback) => {
    callback(isTrustedClipboardWriter(requester, permission));
  });
  secureSession.setDevicePermissionHandler(() => false);

  return () => {
    if (disposed) return;
    disposed = true;
    if (!webContents.isDestroyed()) {
      webContents.off("will-navigate", onNavigate);
      webContents.off("will-redirect", onNavigate);
      webContents.off("will-attach-webview", onWillAttachWebview);
    }
    secureSession.off("will-download", onWillDownload);
    secureSession.setPermissionCheckHandler(null);
    secureSession.setPermissionRequestHandler(null);
    secureSession.setDevicePermissionHandler(null);
  };
}
