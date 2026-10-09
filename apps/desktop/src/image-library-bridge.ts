import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { isImageId } from "@pi67/protocol";
import { app, dialog, type BrowserWindow } from "electron";
import { readVerifiedImagePreview, trustedWorkspaceRoot } from "./app-protocol-image.js";
import type { AuthorizedIpcHandle } from "./authorized-ipc.js";
import type { WorkbenchStateStore } from "./workbench-state.js";
import { addOrRefreshWorkspace } from "./workbench-state-mutations.js";
import { createNativeWorkspaceDescriptor, type NativeWorkspaceDescriptor } from "./workspace-identity.js";
import { teamChatSaveFileName } from "./team-chat-attachment-save.js";

// The creative library (ADR 0010): one directory the user picks once, registered
// as a trusted Workspace that the folder tree never lists. The marker file lets
// the image engine place projects at the library root instead of `.newmoney/images`.
const IMAGE_LIBRARY_FOLDER = "New Money 创作库";
const LIBRARY_MARKER = ".newmoney-library.json";

/**
 * Where the picker opens. Windows prefers the first fixed drive that is not the
 * system drive, so a large library does not fill C:; otherwise the Pictures folder.
 */
export function defaultImageLibraryPath(platform: NodeJS.Platform, systemDrive: string | undefined, pictures: string, driveExists: (root: string) => boolean): string {
  if (platform === "win32") {
    const system = (systemDrive ?? "C:").slice(0, 2).toUpperCase();
    for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      if (`${letter}:` !== system && driveExists(root)) return win32.join(root, IMAGE_LIBRARY_FOLDER);
    }
    return win32.join(pictures, IMAGE_LIBRARY_FOLDER);
  }
  return join(pictures, IMAGE_LIBRARY_FOLDER);
}

export function registerImageLibraryBridge(handle: AuthorizedIpcHandle, getMainWindow: () => BrowserWindow | undefined, workbenchState: WorkbenchStateStore): void {
  handle("pi67:image-library-choose", async (): Promise<NativeWorkspaceDescriptor | undefined> => {
    const window = getMainWindow();
    const options = {
      title: "选择创作库位置",
      buttonLabel: "用作创作库",
      defaultPath: defaultImageLibraryPath(process.platform, process.env.SystemDrive, app.getPath("pictures"), existsSync),
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[]
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const selectedPath = result.canceled ? undefined : result.filePaths[0];
    if (!selectedPath) return undefined;
    await mkdir(selectedPath, { recursive: true });
    const marker = join(selectedPath, LIBRARY_MARKER);
    if (!existsSync(marker)) await writeFile(marker, `${JSON.stringify({ schema: "newmoney.image-library.v1" })}\n`, { flag: "wx" });
    return registerLibrary(workbenchState, await createNativeWorkspaceDescriptor(selectedPath));
  });

  // Saves one rendered PNG the user is looking at; only bytes that still hash to the digest are written.
  handle("pi67:image-save", async (_event, value: unknown): Promise<boolean> => {
    const request = asImageSaveRequest(value);
    const bytes = await readVerifiedImagePreview(request, trustedWorkspaceRoot(() => workbenchState));
    if (!bytes) throw new Error("The image is no longer available; render it again.");
    const window = getMainWindow();
    const options = { title: "导出图片", defaultPath: join(app.getPath("downloads"), `${teamChatSaveFileName(request.fileName).replace(/\.png$/iu, "")}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }] };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, new Uint8Array(bytes));
    return true;
  });
}

/** Registers (or refreshes) the library and records it without changing the user's current Workspace or tree. */
export async function registerLibrary(workbenchState: Pick<WorkbenchStateStore, "update">, selected: NativeWorkspaceDescriptor): Promise<NativeWorkspaceDescriptor> {
  let library = selected;
  await workbenchState.update((state) => {
    const added = addOrRefreshWorkspace(state, selected);
    library = added.workspace;
    // A first registration would make the library the current, expanded Workspace; it never is.
    const { currentWorkspaceId: _first, ...registered } = added.state;
    const current = state.currentWorkspaceId === library.id ? undefined : state.currentWorkspaceId;
    return { ...registered, ...(current ? { currentWorkspaceId: current } : {}),
      expandedWorkspaceIds: state.expandedWorkspaceIds.filter((id) => id !== library.id), imageLibraryWorkspaceId: library.id };
  });
  return library;
}

function asImageSaveRequest(value: unknown): { workspaceId: string; projectId: string; pngSha256: string; fileName: string } {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const { workspaceId, projectId, pngSha256, fileName } = record;
  if (typeof workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(workspaceId) || !isImageId(projectId) ||
    typeof pngSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(pngSha256) || typeof fileName !== "string" || fileName.length > 200) throw new Error("Invalid image save payload.");
  return { workspaceId, projectId, pngSha256, fileName };
}
