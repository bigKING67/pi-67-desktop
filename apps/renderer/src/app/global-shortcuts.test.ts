import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import {
  handleGlobalShortcut,
  installGlobalShortcuts,
  toggleRendererNavigation
} from "./global-shortcuts.js";

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
});

function shortcut(
  key: string,
  overrides: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey">> = {}
) {
  const preventDefault = vi.fn();
  const event = {
    key,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    ...overrides
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
}
