import type { AppState } from "../app/app-store.types.js";

// Narrow port bound by app-store at creation, so session controllers reached from the store's
// own import graph can settle a session transition without importing the store (no runtime cycle).
type SessionTransitionSettlement = (runtime: AppState["runtime"]) => void;
let settle: SessionTransitionSettlement | undefined;

export function bindSessionTransitionSettlement(next: SessionTransitionSettlement): void {
  settle = next;
}

/** Ends a pending session transition and shows the given runtime state for the selected Task. */
export function settleRendererSessionTransition(runtime: AppState["runtime"]): void {
  if (!settle) throw new Error("The app store has not bound session transition settlement.");
  settle(runtime);
}
