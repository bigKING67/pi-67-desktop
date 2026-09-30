import { lstat } from "node:fs/promises";
import { basename } from "node:path";
import { clipboard, dialog, shell, type BrowserWindow } from "electron";
import type { AuthorizedIpcHandle } from "./authorized-ipc.js";
import type { WorkbenchStateStore } from "./workbench-state.js";
import { resolveRegisteredWorkspaceEntry, workspaceEntryLaunchesCode, workspaceEntryRevealAction } from "./workspace-entry.js";

/** Workspace file-tree actions that reach the OS shell; every path is resolved inside a registered root. */
export function registerWorkspaceEntryBridge(
  handle: AuthorizedIpcHandle,
  workbenchState: WorkbenchStateStore,
  getMainWindow: () => BrowserWindow | undefined
): void {
  handle("pi67:workspace-entry-reveal", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    if (workspaceEntryRevealAction(entry) === "show-in-folder") shell.showItemInFolder(entry.absolutePath);
    else await openSystemPath(entry.absolutePath);
    return true;
  });
  handle("pi67:workspace-entry-open-default", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    // Main owns the confirmation so a compromised renderer cannot launch code silently.
    if (workspaceEntryLaunchesCode(entry, (await lstat(entry.absolutePath)).mode)
      && !(await confirmWorkspaceEntryLaunch(getMainWindow(), entry.absolutePath))) return false;
    await openSystemPath(entry.absolutePath);
    return true;
  });
  handle("pi67:workspace-entry-copy", async (_event, value: unknown, mode: unknown) => {
    if (mode !== "absolute" && mode !== "relative") throw new Error("Workspace path copy mode is invalid.");
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    clipboard.writeText(mode === "absolute" ? entry.absolutePath : entry.relativePath);
    return true;
  });
  handle("pi67:workspace-entry-trash", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    const result = await dialog.showMessageBox(getMainWindow()!, {
      type: "warning",
      title: "移到废纸篓",
      message: `将“${entry.relativePath}”移到废纸篓？`,
      detail: "可以从系统废纸篓恢复；New Money 不会执行永久删除。",
      buttons: ["移到废纸篓", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    await shell.trashItem(entry.absolutePath);
    return true;
  });
}

async function confirmWorkspaceEntryLaunch(window: BrowserWindow | undefined, path: string): Promise<boolean> {
  if (!window || window.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    title: "运行这个文件？",
    message: `“${basename(path)}”是可执行文件，用系统默认应用打开会直接运行它。`,
    detail: "只在你信任这个文件的来源时继续。",
    buttons: ["运行", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return response === 0;
}

async function openSystemPath(path: string): Promise<void> {
  const failure = await shell.openPath(path);
  if (failure) throw new Error(failure);
}
