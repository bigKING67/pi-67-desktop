import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShellStore } from "./shell-store.js";
import { toggleRendererContext } from "./context-panel-controller.js";

describe("context panel controller", () => {
  beforeEach(() => {
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("closes synchronously without requesting more window room", async () => {
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
});
