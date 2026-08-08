import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { requestConversationFind } from "../search/conversation-find-events.js";
import { matchDesktopAction } from "./desktop-action-registry.js";

interface GlobalShortcutTarget {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

export function installGlobalShortcuts(target: GlobalShortcutTarget = window) {
  target.addEventListener("keydown", handleGlobalShortcut);
  return () => target.removeEventListener("keydown", handleGlobalShortcut);
}

export function handleGlobalShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  if (shortcutOwnedByFocusedOverlay(event.target)) return;
  const action = matchDesktopAction(event);
  if (!action) return;

  if (action.id === "settings") {
    event.preventDefault();
    rendererWorkbenchStore.getState().openSettings();
    return;
  }
  if (action.id === "command-palette") {
    event.preventDefault();
    useShellStore.getState().setCommandPaletteOpen(true);
    return;
  }
  if (action.id === "keyboard-shortcuts") {
    event.preventDefault();
    useShellStore.getState().setKeyboardShortcutsDialogOpen(true);
    return;
  }

  const workspace = useAppStore.getState().workspace;
  if (!workspace) return;
  if (
    action.id === "find-current-conversation"
    || action.id === "find-workspace-conversations"
  ) {
    event.preventDefault();
    requestConversationFind(action.id === "find-workspace-conversations" ? "workspace" : "current");
    return;
  }
  if (action.id === "new-session") {
    event.preventDefault();
    beginRendererSessionIntent();
    return;
  }
  event.preventDefault();
  if (action.id === "toggle-context") {
    const shell = useShellStore.getState();
    const nextVisible = !shell.contextVisible;
    shell.setContextVisible(nextVisible);
    if (!nextVisible) restoreShortcutTriggerFocus(".context-toggle");
    return;
  }
  if (action.id === "toggle-navigation") toggleRendererNavigation();
}

export function toggleRendererNavigation() {
  const shell = useShellStore.getState();
  const nextVisible = !shell.navigationVisible;
  shell.setNavigationVisible(nextVisible);
  if (nextVisible) shell.setContextVisible(false);
  else restoreShortcutTriggerFocus(".navigation-toggle");
}

function restoreShortcutTriggerFocus(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(selector)?.focus());
}

function shortcutOwnedByFocusedOverlay(target: EventTarget | null): boolean {
  return typeof Element !== "undefined"
    && target instanceof Element
    && Boolean(target.closest('[role="dialog"]'));
}
