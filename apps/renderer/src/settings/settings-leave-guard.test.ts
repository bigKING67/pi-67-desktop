import { afterEach, describe, expect, it, vi } from "vitest";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { registerSettingsLeaveGuard, runAfterLeavingSettings } from "./settings-leave-guard.js";

describe("Settings leave guard", () => {
  let unregister: (() => void) | undefined;
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    rendererWorkbenchStore.getState().reset();
  });

  it("runs immediately when Settings is not the selected surface", async () => {
    const guard = vi.fn();
    unregister = registerSettingsLeaveGuard(guard);
    await expect(runAfterLeavingSettings(() => "ran")).resolves.toBe("ran");
    expect(guard).not.toHaveBeenCalled();
  });

  it("does not start the action when the user keeps editing", async () => {
    rendererWorkbenchStore.getState().openSettings("context-memory");
    unregister = registerSettingsLeaveGuard((_proceed, stay) => stay());
    const action = vi.fn(() => "ran");
    await expect(runAfterLeavingSettings(action)).resolves.toBeUndefined();
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the whole action once the guard admits leaving", async () => {
    rendererWorkbenchStore.getState().openSettings("context-memory");
    unregister = registerSettingsLeaveGuard((proceed) => proceed());
    await expect(runAfterLeavingSettings(async () => "ran")).resolves.toBe("ran");
  });

  it("forgets a guard only when its own registration is disposed", async () => {
    rendererWorkbenchStore.getState().openSettings("context-memory");
    const first = registerSettingsLeaveGuard((_proceed, stay) => stay());
    unregister = registerSettingsLeaveGuard((proceed) => proceed());
    first();
    await expect(runAfterLeavingSettings(() => "ran")).resolves.toBe("ran");
  });
});
