import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShellStore } from "./shell-store.js";
import { toggleRendererContext } from "./context-panel-controller.js";
import { readInspectorDockedPreference } from "./inspector-preference.js";

describe("context panel controller", () => {
  beforeEach(() => {
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("closes synchronously without requesting more window room", async () => {
    useShellStore.setState({ contextVisible: true });
    const ensureRoom = vi.fn(async () => true);

    await toggleRendererContext({
      drawerMatches: () => true,
      ensureRoom,
      reportExpansionFailure: vi.fn()
    });

    expect(useShellStore.getState().contextVisible).toBe(false);
    expect(ensureRoom).not.toHaveBeenCalled();
  });

  it("requests native room before opening from drawer mode", async () => {
    useShellStore.setState({ contextVisible: false });
    let release: (() => void) | undefined;
    const ensureRoom = vi.fn(() => new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    }));

    const opening = toggleRendererContext({
      drawerMatches: () => true,
      ensureRoom,
      reportExpansionFailure: vi.fn()
    });
    expect(useShellStore.getState().contextVisible).toBe(false);
    release?.();
    await opening;

    expect(ensureRoom).toHaveBeenCalledOnce();
    expect(useShellStore.getState().contextVisible).toBe(true);
  });

  it("falls back to the drawer when native expansion fails", async () => {
    useShellStore.setState({ contextVisible: false });
    const reportExpansionFailure = vi.fn();

    await toggleRendererContext({
      drawerMatches: () => true,
      ensureRoom: vi.fn(async () => { throw new Error("window unavailable"); }),
      reportExpansionFailure
    });

    expect(reportExpansionFailure).toHaveBeenCalledOnce();
    expect(useShellStore.getState().contextVisible).toBe(true);
  });

  it("opens a docked context panel without resizing an already-wide viewport", async () => {
    useShellStore.setState({ contextVisible: false });
    const ensureRoom = vi.fn(async () => true);

    await toggleRendererContext({
      drawerMatches: () => false,
      ensureRoom,
      reportExpansionFailure: vi.fn()
    });

    expect(ensureRoom).not.toHaveBeenCalled();
    expect(useShellStore.getState().contextVisible).toBe(true);
  });

  it("remembers only explicit docked toggles, never drawer visibility", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); }
      }
    });
    try {
      const docked = { drawerMatches: () => false, ensureRoom: vi.fn(async () => true), reportExpansionFailure: vi.fn() };
      useShellStore.setState({ contextVisible: false });
      await toggleRendererContext(docked);
      expect(readInspectorDockedPreference()).toBe(true);
      expect(docked.ensureRoom).not.toHaveBeenCalled();

      await toggleRendererContext({ ...docked, drawerMatches: () => true });
      expect(useShellStore.getState().contextVisible).toBe(false);
      expect(readInspectorDockedPreference()).toBe(true);

      useShellStore.setState({ contextVisible: true });
      await toggleRendererContext(docked);
      expect(readInspectorDockedPreference()).toBe(false);

      // A drawer open that widens the window docks the Inspector and is remembered.
      await toggleRendererContext({ ...docked, drawerMatches: () => true, ensureRoom: vi.fn(async () => true) });
      expect(readInspectorDockedPreference()).toBe(true);

      // Chat mode renders no docked Inspector, so its toggles never rewrite the choice.
      useShellStore.setState({ workspaceMode: "chat", contextVisible: true });
      await toggleRendererContext(docked);
      expect(readInspectorDockedPreference()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
