import type { BrowserWindow, Rectangle } from "electron";
import { DESKTOP_CONTEXT_DRAWER_MAX_WIDTH } from "@pi67/protocol";

type ContextRoomWindow = Pick<
  BrowserWindow,
  "getBounds" | "getContentSize" | "isDestroyed" | "isFullScreen" | "isMaximized" | "setBounds"
>;

const DOCKED_CONTEXT_CONTENT_WIDTH = DESKTOP_CONTEXT_DRAWER_MAX_WIDTH + 1;

export function ensureMainWindowContextRoom(
  window: ContextRoomWindow | undefined,
  workArea: Rectangle | undefined
): boolean {
  if (!window || window.isDestroyed()) return false;
  const contentWidth = window.getContentSize()[0] ?? 0;
  if (contentWidth >= DOCKED_CONTEXT_CONTENT_WIDTH) return true;
  if (!workArea || window.isMaximized() || window.isFullScreen()) return false;

  const bounds = window.getBounds();
  const frameWidth = Math.max(0, bounds.width - contentWidth);
  const targetOuterWidth = DOCKED_CONTEXT_CONTENT_WIDTH + frameWidth;
  if (targetOuterWidth > workArea.width) return false;

  const centeredX = Math.round(bounds.x + (bounds.width - targetOuterWidth) / 2);
  const maximumX = workArea.x + workArea.width - targetOuterWidth;
  const targetX = Math.min(maximumX, Math.max(workArea.x, centeredX));
  window.setBounds({ ...bounds, width: targetOuterWidth, x: targetX });
  return (window.getContentSize()[0] ?? 0) >= DOCKED_CONTEXT_CONTENT_WIDTH;
}
