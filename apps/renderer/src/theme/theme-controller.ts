import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export interface ThemeSnapshot {
  preference: ThemePreference;
  effective: EffectiveTheme;
  persistence: "persistent" | "memory";
}

const THEME_STORAGE_KEY = "pi67.themePreference";

const listeners = new Set<() => void>();
let initialized = false;
let mediaQuery: MediaQueryList | undefined;
let storage: Storage | undefined;
let snapshot: ThemeSnapshot = Object.freeze({
  preference: "system",
  effective: "light",
  persistence: "memory"
});

export function initializeThemeController(): ThemeSnapshot {
  if (initialized) return snapshot;
  initialized = true;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const stored = readStoredPreference();
  storage = stored.storage;
  snapshot = Object.freeze({
    preference: stored.preference,
    effective: resolveTheme(stored.preference, mediaQuery.matches),
    persistence: storage ? "persistent" : "memory"
  });
  applyTheme(snapshot);
  mediaQuery.addEventListener("change", handleSystemThemeChange);
  return snapshot;
}

export function useThemeSnapshot(): ThemeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setThemePreference(preference: ThemePreference): void {
  if (!initialized) initializeThemeController();
  const persistence = persistPreference(preference);
  commitSnapshot({
    preference,
    effective: resolveTheme(preference, mediaQuery?.matches ?? false),
    persistence
  });
}

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): EffectiveTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

function getSnapshot(): ThemeSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function handleSystemThemeChange(event: MediaQueryListEvent): void {
  if (snapshot.preference !== "system") return;
  commitSnapshot({ ...snapshot, effective: event.matches ? "dark" : "light" });
}

function commitSnapshot(next: ThemeSnapshot): void {
  const changed = next.preference !== snapshot.preference
    || next.effective !== snapshot.effective
    || next.persistence !== snapshot.persistence;
  snapshot = Object.freeze(next);
  applyTheme(snapshot);
  if (changed) for (const listener of listeners) listener();
}

function applyTheme(next: ThemeSnapshot): void {
  document.documentElement.dataset.theme = next.effective;
  document.documentElement.dataset.themePreference = next.preference;
}

function readStoredPreference(): { preference: ThemePreference; storage?: Storage } {
  try {
    const localStorage = window.localStorage;
    return {
      preference: parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
      storage: localStorage
    };
  } catch {
    return { preference: "system" };
  }
}

function persistPreference(preference: ThemePreference): ThemeSnapshot["persistence"] {
  if (!storage) return "memory";
  try {
    if (preference === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
    return "persistent";
  } catch {
    storage = undefined;
    return "memory";
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => mediaQuery?.removeEventListener("change", handleSystemThemeChange));
}
