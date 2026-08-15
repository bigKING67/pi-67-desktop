import { useShellStore } from "../shell/shell-store.js";

interface FocusReturnTarget extends EventTarget {
  readonly isConnected: boolean;
  focus(options?: FocusOptions): void;
}

let focusReturnTarget: FocusReturnTarget | undefined;

export function openKeyboardShortcutsDialog(target: EventTarget | null = activeElement()) {
  const shell = useShellStore.getState();
  if (!shell.keyboardShortcutsDialogOpen && isFocusReturnTarget(target)) {
    focusReturnTarget = target;
  }
  shell.setKeyboardShortcutsDialogOpen(true);
}

export function closeKeyboardShortcutsDialog() {
  useShellStore.getState().setKeyboardShortcutsDialogOpen(false);
  restoreKeyboardShortcutsDialogFocus();
}

export function restoreKeyboardShortcutsDialogFocus() {
  const target = focusReturnTarget;
  focusReturnTarget = undefined;
  if (!target) return;
  scheduleAfterOverlayCleanup(() => {
    if (target.isConnected) target.focus({ preventScroll: true });
  });
}

function activeElement(): EventTarget | null {
  return typeof document === "undefined" ? null : document.activeElement;
}

function isFocusReturnTarget(target: EventTarget | null): target is FocusReturnTarget {
  if (target === null || typeof target !== "object") return false;
  const candidate = target as Partial<FocusReturnTarget>;
  return typeof candidate.focus === "function" && typeof candidate.isConnected === "boolean";
}

function scheduleAfterOverlayCleanup(callback: () => void) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else queueMicrotask(callback);
}
