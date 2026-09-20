import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { LocalMemoryRuntimeInstallResult, LocalMemoryRuntimePurpose } from "@pi67/protocol";
import type { LocalMemoryRuntimeController } from "./local-memory-runtime-controller.js";
import { isExpectedRendererLocation, PACKAGED_RENDERER_URL } from "./renderer-security.js";

const purposeTitles: Record<LocalMemoryRuntimePurpose, string> = {
  private: "私人记忆运行包", "team-index-v1": "团队索引运行包", "team-query-v1": "团队检索运行包"
};
function parsePurpose(args: unknown[]): LocalMemoryRuntimePurpose {
  if (!args.length) return "private";
  if (args.length === 1 && (args[0] === "private" || args[0] === "team-index-v1" || args[0] === "team-query-v1")) return args[0];
  throw new Error("Runtime installation arguments are not authorized.");
}

export function registerLocalMemoryRuntimeBridge(
  getWindow: () => BrowserWindow | undefined,
  getController: () => LocalMemoryRuntimeController | undefined,
  rendererUrl = PACKAGED_RENDERER_URL
) {
  let disposed = false;
  let active: AbortController | undefined;
  function authorize(event: IpcMainInvokeEvent) {
    const window = getWindow();
    if (disposed || !window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame || !isExpectedRendererLocation(event.senderFrame.url, rendererUrl)) {
      throw new Error("Runtime installation sender is not authorized.");
    }
    return window;
  }
  ipcMain.handle("pi67:local-memory-runtime-status", async (event, ...args: unknown[]) => {
    authorize(event);
    const purpose = parsePurpose(args);
    try { return await getController()?.getStatus(purpose) ?? "unavailable"; } catch { return "unavailable"; }
  });
  ipcMain.handle("pi67:local-memory-runtime-cancel", (event, ...args: unknown[]) => {
    authorize(event);
    if (args.length) throw new Error("Runtime installation arguments are not authorized.");
    active?.abort();
  });
  ipcMain.handle("pi67:local-memory-runtime-install", async (event, ...args: unknown[]): Promise<LocalMemoryRuntimeInstallResult> => {
    const window = authorize(event);
    const purpose = parsePurpose(args);
    const controller = getController();
    if (!controller) return "unavailable";
    if (active) return "busy";
    const abort = new AbortController(); active = abort;
    const cancel = () => abort.abort();
    const contents = window.webContents;
    contents.on("destroyed", cancel); contents.on("render-process-gone", cancel); contents.on("did-start-navigation", cancel);
    try {
      const selection = await dialog.showOpenDialog(window, { title: `选择 New Money ${purposeTitles[purpose]}`,
        buttonLabel: "验签并安装", properties: ["openDirectory"],
        message: "选择包含 manifest.json、manifest.sig 和 runtime 的已签名目录。安装不会启用记忆服务。" });
      abort.signal.throwIfAborted();
      authorize(event);
      if (selection.canceled) return "cancelled";
      if (selection.filePaths.length !== 1 || !selection.filePaths[0]) return "failed";
      await controller.install(selection.filePaths[0], abort.signal, purpose);
      return "installed";
    } catch { return abort.signal.aborted ? "cancelled" : "failed"; }
    finally {
      contents.removeListener("destroyed", cancel); contents.removeListener("render-process-gone", cancel);
      contents.removeListener("did-start-navigation", cancel); active = undefined;
    }
  });
  return () => {
    disposed = true; active?.abort();
    for (const action of ["status", "cancel", "install"]) ipcMain.removeHandler(`pi67:local-memory-runtime-${action}`);
  };
}
