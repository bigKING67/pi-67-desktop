import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShellStore } from "../shell/shell-store.js";
import {
  closeKeyboardShortcutsDialog,
  openKeyboardShortcutsDialog,
  restoreKeyboardShortcutsDialogFocus
} from "./keyboard-shortcuts-dialog-controller.js";

class FocusTarget extends EventTarget {
  isConnected = true;
  focus = vi.fn();
}

describe("keyboard shortcuts dialog controller", () => {
  beforeEach(() => {
    restoreKeyboardShortcutsDialogFocus();
    useShellStore.setState(useShellStore.getInitialState(), true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("restores the focus target captured when the dialog first opens", () => {
    const composer = new FocusTarget();
    const laterTarget = new FocusTarget();

    openKeyboardShortcutsDialog(composer);
    openKeyboardShortcutsDialog(laterTarget);
    closeKeyboardShortcutsDialog();

    expect(useShellStore.getState().keyboardShortcutsDialogOpen).toBe(false);
    expect(composer.focus).toHaveBeenCalledOnce();
    expect(composer.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(laterTarget.focus).not.toHaveBeenCalled();
  });

  it("does not focus a trigger that was removed while the dialog was open", () => {
    const trigger = new FocusTarget();
    openKeyboardShortcutsDialog(trigger);
    trigger.isConnected = false;

    closeKeyboardShortcutsDialog();

    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
