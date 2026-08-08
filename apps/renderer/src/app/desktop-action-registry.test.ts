import { describe, expect, it } from "vitest";
import {
  desktopAction,
  desktopShortcutAriaKeys,
  formatDesktopShortcut,
  matchDesktopAction
} from "./desktop-action-registry.js";

describe("desktop action registry", () => {
  it("formats the same binding for Windows and macOS", () => {
    const action = desktopAction("find-workspace-conversations");

    expect(formatDesktopShortcut(action, "win32")).toBe("Ctrl+Shift+F");
    expect(formatDesktopShortcut(action, "darwin")).toBe("⌘⇧F");
    expect(desktopShortcutAriaKeys(action)).toBe("Control+Shift+F Meta+Shift+F");
  });

  it("matches exact primary-modifier and Shift ownership", () => {
    expect(matchDesktopAction(shortcut("f"))?.id).toBe("find-current-conversation");
    expect(matchDesktopAction(shortcut("f", { shiftKey: true }))?.id)
      .toBe("find-workspace-conversations");
    expect(matchDesktopAction(shortcut("f", { altKey: true }))).toBeUndefined();
  });

  it("keeps both new-Session aliases in one action", () => {
    expect(matchDesktopAction(shortcut("n"))?.id).toBe("new-session");
    expect(matchDesktopAction(shortcut("t"))?.id).toBe("new-session");
    expect(formatDesktopShortcut(desktopAction("new-session"), "win32"))
      .toBe("Ctrl+N / Ctrl+T");
  });
});

function shortcut(
  key: string,
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "shiftKey">> = {}
): KeyboardEvent {
  return {
    key,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    ...overrides
  } as KeyboardEvent;
}
