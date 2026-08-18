import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { requestConversationFind } from "../search/conversation-find-events.js";
import {
  matchDesktopAction,
  type DesktopActionDescriptor,
  type DesktopShortcutContext
} from "./desktop-action-registry.js";
import { effectiveDesktopActions } from "./desktop-shortcut-preferences.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import {
  closeKeyboardShortcutsDialog,
  openKeyboardShortcutsDialog
} from "../help/keyboard-shortcuts-dialog-controller.js";
import { toggleRendererContext } from "../shell/context-panel-controller.js";

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
  const ownedByOverlay = shortcutOwnedByFocusedOverlay(event.target);
  if (
    event.key === "Escape"
    && useShellStore.getState().keyboardShortcutsDialogOpen
    && !ownedByOverlay
  ) {
    event.preventDefault();
    closeKeyboardShortcutsDialog();
    return;
  }
  if (ownedByOverlay) return;
  const action = matchDesktopAction(event, effectiveDesktopActions());
  if (!action) return;
  if (!desktopActionAllowedInContexts(action, activeShortcutContexts(event.target))) return;

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
    openKeyboardShortcutsDialog(event.target);
    return;
  }

  const workspace = useAppStore.getState().workspace;
  if (!workspace) return;
  if (
    action.id === "find-current-conversation"
    || action.id === "find-workspace-conversations"
    || action.id === "find-workspace-content"
  ) {
    event.preventDefault();
    if (action.id === "find-workspace-content") {
      useShellStore.getState().setWorkspaceContentSearchDialogOpen(true);
    } else {
      requestConversationFind(action.id === "find-workspace-conversations" ? "workspace" : "current");
    }
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
    void toggleRendererContext();
    if (!nextVisible) restoreShortcutTriggerFocus(".context-toggle");
    return;
  }
  if (action.id === "toggle-navigation") toggleRendererNavigation();
}

export function desktopActionAllowedInContexts(
  action: DesktopActionDescriptor,
  contexts: {
    surface?: Extract<DesktopShortcutContext, "workspaceOpen" | "composerFocus" | "settingsOpen" | "fileEditorFocus">;
    lifecycle: Extract<DesktopShortcutContext, "taskRunning" | "taskIdle">;
  }
): boolean {
  if (!action.contexts.includes(contexts.lifecycle)) return false;
  return contexts.surface === undefined || action.contexts.includes(contexts.surface);
}

function activeShortcutContexts(target: EventTarget | null): {
  surface?: Extract<DesktopShortcutContext, "workspaceOpen" | "composerFocus" | "settingsOpen" | "fileEditorFocus">;
  lifecycle: Extract<DesktopShortcutContext, "taskRunning" | "taskIdle">;
} {
  const operation = useAppStore.getState().operation;
  const lifecycle = operation && isActiveOperationLifecycle(operation.lifecycle)
    ? "taskRunning"
    : "taskIdle";
  if (rendererWorkbenchStore.getState().selectedSurface?.kind === "settings") {
    return { surface: "settingsOpen", lifecycle };
  }
  if (typeof Element !== "undefined" && target instanceof Element) {
    if (target.closest(".workspace-file-editor")) return { surface: "fileEditorFocus", lifecycle };
    if (target.closest('[data-testid="composer-region"]')) return { surface: "composerFocus", lifecycle };
  }
  return useAppStore.getState().workspace
    ? { surface: "workspaceOpen", lifecycle }
    : { lifecycle };
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
