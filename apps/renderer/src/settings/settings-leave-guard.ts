import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

/** Settings resolves a leave request by calling exactly one of `proceed` or `stay`. */
export type SettingsLeaveGuard = (proceed: () => void, stay: () => void) => void;

let activeGuard: SettingsLeaveGuard | undefined;

export function registerSettingsLeaveGuard(guard: SettingsLeaveGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = undefined;
  };
}

/**
 * Runs a whole user action that leaves Settings only after the Settings draft guard admits it.
 * Guarding the entry point, not the store transition, keeps multi-step flows such as opening a
 * session from starting when the user chooses to keep editing. Resolves `undefined` in that case.
 */
export function runAfterLeavingSettings<T>(action: () => T | Promise<T>): Promise<T | undefined> {
  const guard = activeGuard;
  if (!guard || rendererWorkbenchStore.getState().selectedSurface?.kind !== "settings") {
    return Promise.resolve().then(action);
  }
  return new Promise<T | undefined>((resolve, reject) => {
    guard(
      () => { Promise.resolve().then(action).then(resolve, reject); },
      () => resolve(undefined)
    );
  });
}
