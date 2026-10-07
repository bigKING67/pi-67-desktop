/**
 * The docked Inspector is closed by default so the conversation owns the window;
 * only an explicit wide-layout toggle is remembered across launches. Drawer-mode
 * visibility and on-demand reveals (such as opening a changed file) stay transient.
 */
const STORAGE_KEY = "pi67.inspector-docked.v1";

export function readInspectorDockedPreference(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

export function writeInspectorDockedPreference(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Storage unavailability keeps the current window's choice without persisting it.
  }
}
