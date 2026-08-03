import { createRendererSession } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";

interface GlobalShortcutTarget {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

export function installGlobalShortcuts(target: GlobalShortcutTarget = window) {
  target.addEventListener("keydown", handleGlobalShortcut);
  return () => target.removeEventListener("keydown", handleGlobalShortcut);
}

export function handleGlobalShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;

  const key = event.key.toLowerCase();
  if (key === ",") {
    event.preventDefault();
    rendererWorkbenchStore.getState().openSettings();
    return;
  }
  if (key === "k") {
    event.preventDefault();
    useShellStore.getState().setCommandPaletteOpen(true);
    return;
  }

  const workspace = useAppStore.getState().workspace;
  if ((key === "n" || key === "t") && workspace) {
    event.preventDefault();
    void createRendererSession();
    return;
  }
  if (key !== "b" || !workspace) return;

  event.preventDefault();
  if (event.shiftKey) {
    const shell = useShellStore.getState();
    const nextVisible = !shell.contextVisible;
    shell.setContextVisible(nextVisible);
    if (!nextVisible) restoreShortcutTriggerFocus(".context-toggle");
    return;
  }
  toggleRendererNavigation();
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
