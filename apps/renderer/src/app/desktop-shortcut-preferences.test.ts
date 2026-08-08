import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindingFromKeyboardEvent,
  effectiveDesktopAction,
  reloadDesktopShortcutsForTests,
  resetAllDesktopShortcuts,
  resetDesktopShortcut,
  setDesktopShortcut
} from "./desktop-shortcut-preferences.js";

const STORAGE_KEY = "pi67.desktop-shortcuts.v1";
const stored = new Map<string, string>();

describe("desktop shortcut preferences", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key)
      }
    });
    reloadDesktopShortcutsForTests();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists only normalized allowlisted bindings and restores defaults", () => {
    expect(setDesktopShortcut("settings", { key: ".", shift: true })).toEqual({ status: "saved" });
    expect(effectiveDesktopAction("settings").bindings).toEqual([{ key: ".", shift: true }]);
    expect(JSON.parse(stored.get(STORAGE_KEY)!)).toEqual({
      version: 1,
      overrides: { settings: { key: ".", shift: true } }
    });
    resetDesktopShortcut("settings");
    expect(effectiveDesktopAction("settings").bindings).toEqual([{ key: "," }]);

    setDesktopShortcut("settings", { key: "." });
    resetAllDesktopShortcuts();
    expect(effectiveDesktopAction("settings").bindings).toEqual([{ key: "," }]);
  });

  it("rejects conflicts, unsupported keys, and modifiers without a primary key", () => {
    expect(setDesktopShortcut("settings", { key: "f" })).toEqual({
      status: "conflict",
      actionId: "find-current-conversation"
    });
    expect(setDesktopShortcut("settings", { key: "escape" })).toEqual({ status: "invalid" });
    expect(bindingFromKeyboardEvent({
      key: "Meta",
      metaKey: true,
      ctrlKey: false
    } as KeyboardEvent)).toBeUndefined();
  });

  it("clears corrupt, unknown, or duplicate persisted overrides", () => {
    for (const payload of [
      "{not-json",
      JSON.stringify({ version: 1, overrides: { unknown: { key: "q" } } }),
      JSON.stringify({
        version: 1,
        overrides: {
          settings: { key: "q" },
          "command-palette": { key: "q" }
        }
      })
    ]) {
      stored.set(STORAGE_KEY, payload);
      reloadDesktopShortcutsForTests();
      expect(effectiveDesktopAction("settings").bindings).toEqual([{ key: "," }]);
      expect(stored.has(STORAGE_KEY)).toBe(false);
    }
  });
});
