import { useSyncExternalStore } from "react";
import {
  DESKTOP_ACTIONS,
  type DesktopActionDescriptor,
  type DesktopActionId,
  type DesktopShortcutBinding
} from "./desktop-action-registry.js";

const STORAGE_KEY = "pi67.desktop-shortcuts.v1";
const ACTION_IDS = new Set<DesktopActionId>(DESKTOP_ACTIONS.map((action) => action.id));
const listeners = new Set<() => void>();
let revision = 0;
let loaded = false;
let overrides: Partial<Record<DesktopActionId, DesktopShortcutBinding>> = {};

interface StoredShortcuts {
  version: 1;
  overrides: Partial<Record<DesktopActionId, DesktopShortcutBinding>>;
}

export function effectiveDesktopActions(): DesktopActionDescriptor[] {
  ensureLoaded();
  return DESKTOP_ACTIONS.map((action) => {
    const override = overrides[action.id];
    return override ? { ...action, bindings: [override] } : action;
  });
}

export function effectiveDesktopAction(id: DesktopActionId): DesktopActionDescriptor {
  return effectiveDesktopActions().find((action) => action.id === id)!;
}

export function setDesktopShortcut(
  id: DesktopActionId,
  binding: DesktopShortcutBinding
): { status: "saved" } | { status: "conflict"; actionId: DesktopActionId } | { status: "invalid" } {
  ensureLoaded();
  const normalized = normalizeBinding(binding);
  if (!normalized) return { status: "invalid" };
  const conflict = effectiveDesktopActions().find((action) => (
    action.id !== id && action.bindings.some((candidate) => sameBinding(candidate, normalized))
  ));
  if (conflict) return { status: "conflict", actionId: conflict.id };
  overrides = { ...overrides, [id]: normalized };
  persistAndPublish();
  return { status: "saved" };
}

export function resetDesktopShortcut(id: DesktopActionId): void {
  ensureLoaded();
  if (overrides[id] === undefined) return;
  const next = { ...overrides };
  delete next[id];
  overrides = next;
  persistAndPublish();
}

export function resetAllDesktopShortcuts(): void {
  ensureLoaded();
  if (Object.keys(overrides).length === 0) return;
  overrides = {};
  persistAndPublish();
}

export function desktopShortcutIsCustomized(id: DesktopActionId): boolean {
  ensureLoaded();
  return overrides[id] !== undefined;
}

export function bindingFromKeyboardEvent(event: KeyboardEvent): DesktopShortcutBinding | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.key === "Meta" || event.key === "Control") return undefined;
  return normalizeBinding({
    key: event.key.toLocaleLowerCase(),
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {})
  });
}

export function useDesktopShortcutRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

export function reloadDesktopShortcutsForTests(): void {
  loaded = false;
  overrides = {};
  revision += 1;
  emit();
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = parseStoredShortcuts(JSON.parse(raw) as unknown);
    if (!parsed) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    overrides = parsed.overrides;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function parseStoredShortcuts(value: unknown): StoredShortcuts | undefined {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.overrides)) return undefined;
  if (Object.keys(value).some((key) => key !== "version" && key !== "overrides")) return undefined;
  const parsed: StoredShortcuts["overrides"] = {};
  const seen = new Map<string, DesktopActionId>();
  for (const [id, rawBinding] of Object.entries(value.overrides)) {
    if (!ACTION_IDS.has(id as DesktopActionId)) return undefined;
    const binding = normalizeBinding(rawBinding);
    if (!binding) return undefined;
    const fingerprint = bindingFingerprint(binding);
    if (seen.has(fingerprint)) return undefined;
    seen.set(fingerprint, id as DesktopActionId);
    parsed[id as DesktopActionId] = binding;
  }
  return { version: 1, overrides: parsed };
}

function normalizeBinding(value: unknown): DesktopShortcutBinding | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).some((key) => key !== "key" && key !== "shift" && key !== "alt")) return undefined;
  const key = typeof value.key === "string" ? value.key.toLocaleLowerCase() : "";
  if (!isSupportedKey(key)) return undefined;
  if (value.shift !== undefined && typeof value.shift !== "boolean") return undefined;
  if (value.alt !== undefined && typeof value.alt !== "boolean") return undefined;
  return {
    key,
    ...(value.shift === true ? { shift: true } : {}),
    ...(value.alt === true ? { alt: true } : {})
  };
}

function isSupportedKey(key: string): boolean {
  return /^[a-z0-9]$/u.test(key)
    || key === ","
    || key === "/"
    || key === "."
    || key === ";"
    || key === "'"
    || key === "["
    || key === "]"
    || /^f(?:[1-9]|1[0-2])$/u.test(key);
}

function persistAndPublish(): void {
  if (typeof window !== "undefined") {
    const stored: StoredShortcuts = { version: 1, overrides };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }
  revision += 1;
  emit();
}

function sameBinding(left: DesktopShortcutBinding, right: DesktopShortcutBinding): boolean {
  return bindingFingerprint(left) === bindingFingerprint(right);
}

function bindingFingerprint(binding: DesktopShortcutBinding): string {
  return `${Boolean(binding.alt)}:${Boolean(binding.shift)}:${binding.key}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getRevision(): number {
  ensureLoaded();
  return revision;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
