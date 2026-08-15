import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { subscribeConversationFind } from "../search/conversation-find-events.js";
import {
  desktopActionAllowedInContexts,
  handleGlobalShortcut,
  installGlobalShortcuts,
  toggleRendererNavigation
} from "./global-shortcuts.js";
import { desktopAction } from "./desktop-action-registry.js";

vi.mock("../session/session-lifecycle-controller.js", () => ({
  beginRendererSessionIntent: vi.fn()
}));

const beginIntent = vi.mocked(beginRendererSessionIntent);

describe("global shortcuts", () => {
  beforeEach(() => {
    beginIntent.mockReset();
    rendererWorkbenchStore.getState().reset();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("installs one stable listener that reads the latest Workspace and shell state", () => {
    let listener: ((event: KeyboardEvent) => void) | undefined;
    const target = {
      addEventListener: vi.fn((_type: "keydown", next: (event: KeyboardEvent) => void) => {
        listener = next;
      }),
      removeEventListener: vi.fn()
    };
    const uninstall = installGlobalShortcuts(target);

    useAppStore.setState({ workspace: "/work/latest" });
    useShellStore.setState({ navigationVisible: false, contextVisible: true });
    listener?.(shortcut("b").event);

    expect(useShellStore.getState()).toMatchObject({
      navigationVisible: true,
      contextVisible: false
    });
    uninstall();
    expect(target.addEventListener).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", listener);
  });

  it("opens Settings and the command palette without Workspace authority", () => {
    const settings = shortcut(",");
    const palette = shortcut("k", { metaKey: true, ctrlKey: false });

    handleGlobalShortcut(settings.event);
    handleGlobalShortcut(palette.event);

    expect(settings.preventDefault).toHaveBeenCalledOnce();
    expect(palette.preventDefault).toHaveBeenCalledOnce();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({ kind: "settings" });
    expect(useShellStore.getState().commandPaletteOpen).toBe(true);
  });

  it("keeps global surfaces reachable while a Workspace is open", () => {
    useAppStore.setState({ workspace: "/work/latest" });
    const settings = shortcut(",");
    const palette = shortcut("k");
    const help = shortcut("/");

    handleGlobalShortcut(settings.event);
    handleGlobalShortcut(palette.event);
    handleGlobalShortcut(help.event);

    expect(settings.preventDefault).toHaveBeenCalledOnce();
    expect(palette.preventDefault).toHaveBeenCalledOnce();
    expect(help.preventDefault).toHaveBeenCalledOnce();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({ kind: "settings" });
    expect(useShellStore.getState()).toMatchObject({
      commandPaletteOpen: true,
      keyboardShortcutsDialogOpen: true
    });
  });

  it("opens keyboard help without Workspace authority", () => {
    const help = shortcut("/");

    handleGlobalShortcut(help.event);

    expect(help.preventDefault).toHaveBeenCalledOnce();
    expect(useShellStore.getState().keyboardShortcutsDialogOpen).toBe(true);
  });

  it("closes keyboard help on Escape even before the lazy dialog takes focus", () => {
    useShellStore.setState({ keyboardShortcutsDialogOpen: true });
    const escape = shortcut("Escape", { ctrlKey: false });

    handleGlobalShortcut(escape.event);

    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(useShellStore.getState().keyboardShortcutsDialogOpen).toBe(false);
  });

  it("leaves a focused keyboard dialog Escape to its overlay controller", () => {
    class OverlayElement {
      closest(selector: string) {
        return selector === '[role="dialog"]' ? this : null;
      }
    }
    vi.stubGlobal("Element", OverlayElement);
    useShellStore.setState({ keyboardShortcutsDialogOpen: true });
    const escape = shortcut("Escape", { ctrlKey: false });
    Object.assign(escape.event, { target: new OverlayElement() });

    try {
      handleGlobalShortcut(escape.event);

      expect(escape.preventDefault).not.toHaveBeenCalled();
      expect(useShellStore.getState().keyboardShortcutsDialogOpen).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates Sessions only when the latest state has Workspace authority", () => {
    const blocked = shortcut("n");
    handleGlobalShortcut(blocked.event);
    expect(blocked.preventDefault).not.toHaveBeenCalled();
    expect(beginIntent).not.toHaveBeenCalled();

    useAppStore.setState({ workspace: "/work/latest" });
    handleGlobalShortcut(shortcut("n").event);
    handleGlobalShortcut(shortcut("t").event);
    expect(beginIntent).toHaveBeenCalledTimes(2);
  });

  it("toggles the latest navigation and context drawer state", () => {
    useAppStore.setState({ workspace: "/work/latest" });
    useShellStore.setState({ navigationVisible: false, contextVisible: true });

    toggleRendererNavigation();
    expect(useShellStore.getState()).toMatchObject({
      navigationVisible: true,
      contextVisible: false
    });

    useShellStore.setState({ contextVisible: false });
    handleGlobalShortcut(shortcut("b", { shiftKey: true }).event);
    expect(useShellStore.getState().contextVisible).toBe(true);
  });

  it("routes current and Workspace text search without introducing a search toggle", () => {
    const scopes: string[] = [];
    const unsubscribe = subscribeConversationFind((scope) => scopes.push(scope));
    useAppStore.setState({ workspace: "/work/latest" });
    const current = shortcut("f");
    const workspace = shortcut("f", { shiftKey: true });

    handleGlobalShortcut(current.event);
    handleGlobalShortcut(workspace.event);

    expect(scopes).toEqual(["current", "workspace"]);
    expect(current.preventDefault).toHaveBeenCalledOnce();
    expect(workspace.preventDefault).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("does not intercept an owned or IME-composition shortcut", () => {
    const owned = shortcut("f");
    Object.assign(owned.event, { defaultPrevented: true });
    const composing = shortcut("f");
    Object.assign(composing.event, { isComposing: true });
    useAppStore.setState({ workspace: "/work/latest" });

    handleGlobalShortcut(owned.event);
    handleGlobalShortcut(composing.event);

    expect(owned.preventDefault).not.toHaveBeenCalled();
    expect(composing.preventDefault).not.toHaveBeenCalled();
  });

  it("gates actions by the active surface and task lifecycle", () => {
    expect(desktopActionAllowedInContexts(desktopAction("find-current-conversation"), {
      surface: "settingsOpen",
      lifecycle: "taskIdle"
    })).toBe(false);
    expect(desktopActionAllowedInContexts(desktopAction("command-palette"), {
      surface: "settingsOpen",
      lifecycle: "taskRunning"
    })).toBe(true);
    expect(desktopActionAllowedInContexts(desktopAction("new-session"), {
      surface: "composerFocus",
      lifecycle: "taskRunning"
    })).toBe(true);
    expect(desktopActionAllowedInContexts(desktopAction("new-session"), {
      surface: "fileEditorFocus",
      lifecycle: "taskIdle"
    })).toBe(true);
    expect(desktopActionAllowedInContexts(desktopAction("find-current-conversation"), {
      surface: "composerFocus",
      lifecycle: "taskIdle"
    })).toBe(true);
    expect(desktopActionAllowedInContexts(desktopAction("find-current-conversation"), {
      surface: "fileEditorFocus",
      lifecycle: "taskIdle"
    })).toBe(false);
  });

  it("leaves Settings Cmd/Ctrl+F to the Settings search owner", () => {
    rendererWorkbenchStore.setState({ selectedSurface: { kind: "settings" } });
    useAppStore.setState({ workspace: "/work/latest" });
    const find = shortcut("f");
    handleGlobalShortcut(find.event);
    expect(find.preventDefault).not.toHaveBeenCalled();
  });
});

function shortcut(
  key: string,
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {}
) {
  const preventDefault = vi.fn();
  const event = {
    key,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    ...overrides
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
}
