import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isValidTeamChatAttachmentSave } from "@pi67/protocol";
import { app, dialog, type BrowserWindow } from "electron";
import type { AuthorizedIpcHandle } from "./authorized-ipc.js";

/**
 * Saves a Team Chat attachment the renderer already holds (ADR 0009). The user picks
 * the place; Main writes nothing without that choice and never opens the file.
 */
export function registerTeamChatAttachmentSaveBridge(
  handle: AuthorizedIpcHandle,
  getMainWindow: () => BrowserWindow | undefined
): void {
  handle("pi67:team-chat-attachment-save", async (_event, value: unknown) => {
    if (!isValidTeamChatAttachmentSave(value)) throw new Error("Invalid attachment save payload.");
    const fileName = teamChatSaveFileName(value.fileName);
    const window = getMainWindow();
    const options = { title: "保存附件", defaultPath: join(app.getPath("downloads"), fileName) };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, new Uint8Array(value.data));
    return true;
  });
}

/** A suggested name only: no directories, controls or reserved characters. */
export function teamChatSaveFileName(raw: string): string {
  const name = raw.replace(/[\p{Cc}<>:"/\\|?*]/gu, "_").replace(/^[.\s]+|[.\s]+$/gu, "");
  return name || "attachment";
}
