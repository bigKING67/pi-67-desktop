import type { ComposerDraftModelSelection, SessionControlsView } from "@pi67/domain";

const STORAGE_KEY = "pi67.recent-session-runtime.v1";
const MAX_ENTRIES = 100;
const MAX_IDENTIFIER_CHARS = 512;
const MAX_THINKING_LEVEL_CHARS = 64;

export interface RecentSessionRuntimePreference {
  model: ComposerDraftModelSelection;
  thinkingLevel?: string;
  updatedAt: number;
}

interface StoredRuntimePreference extends RecentSessionRuntimePreference {
  workspaceId: string;
}

interface StoredRuntimePreferences {
  version: 1;
  items: StoredRuntimePreference[];
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let memoryFallback: StoredRuntimePreferences = emptyPreferences();

export function recentSessionRuntimePreference(
  workspaceId: string,
  storage: PreferenceStorage | undefined = browserStorage()
): RecentSessionRuntimePreference | undefined {
  const item = readPreferences(storage).items.find((candidate) => candidate.workspaceId === workspaceId);
  return item ? preferenceWithoutWorkspace(item) : undefined;
}

export function rememberSessionRuntimePreference(
  workspaceId: string,
  controls: Pick<SessionControlsView, "selectedModel" | "thinkingLevel">,
  options: { now?: number; storage?: PreferenceStorage } = {}
): boolean {
  if (!controls.selectedModel || !validIdentifier(workspaceId)) return false;
  const storage = options.storage ?? browserStorage();
  const next: StoredRuntimePreference = {
    workspaceId,
    model: { provider: controls.selectedModel.provider, model: controls.selectedModel.id },
    ...(validThinkingLevel(controls.thinkingLevel) ? { thinkingLevel: controls.thinkingLevel } : {}),
    updatedAt: options.now ?? Date.now()
  };
  if (!validStoredPreference(next)) return false;
  const current = readPreferences(storage);
  return writePreferences({
    version: 1,
    items: [next, ...current.items.filter((item) => item.workspaceId !== workspaceId)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_ENTRIES)
  }, storage);
}

export function forgetSessionRuntimePreference(
  workspaceId: string,
  storage: PreferenceStorage | undefined = browserStorage()
): void {
  const current = readPreferences(storage);
  writePreferences({
    version: 1,
    items: current.items.filter((item) => item.workspaceId !== workspaceId)
  }, storage);
}

export function resetRecentSessionRuntimePreferencesForTests(): void {
  memoryFallback = emptyPreferences();
}

function readPreferences(storage: PreferenceStorage | undefined): StoredRuntimePreferences {
  if (!storage) return structuredClone(memoryFallback);
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (!serialized) return emptyPreferences();
    const parsed = parsePreferences(JSON.parse(serialized) as unknown);
    if (parsed) {
      memoryFallback = parsed;
      return structuredClone(parsed);
    }
  } catch {
    return structuredClone(memoryFallback);
  }
  memoryFallback = emptyPreferences();
  return structuredClone(memoryFallback);
}

function writePreferences(value: StoredRuntimePreferences, storage: PreferenceStorage | undefined): boolean {
  memoryFallback = structuredClone(value);
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function parsePreferences(value: unknown): StoredRuntimePreferences | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "items"]) || value.version !== 1) return undefined;
  if (!Array.isArray(value.items) || value.items.length > MAX_ENTRIES) return undefined;
  const workspaceIds = new Set<string>();
  const items: StoredRuntimePreference[] = [];
  for (const candidate of value.items) {
    if (!validStoredPreference(candidate) || workspaceIds.has(candidate.workspaceId)) return undefined;
    workspaceIds.add(candidate.workspaceId);
    items.push({
      workspaceId: candidate.workspaceId,
      model: { ...candidate.model },
      ...(candidate.thinkingLevel ? { thinkingLevel: candidate.thinkingLevel } : {}),
      updatedAt: candidate.updatedAt
    });
  }
  return { version: 1, items };
}

function validStoredPreference(value: unknown): value is StoredRuntimePreference {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ["workspaceId", "model", "thinkingLevel", "updatedAt"],
    ["workspaceId", "model", "updatedAt"]
  )) return false;
  if (!validIdentifier(value.workspaceId) || !validModel(value.model)) return false;
  if (value.thinkingLevel !== undefined && !validThinkingLevel(value.thinkingLevel)) return false;
  return Number.isSafeInteger(value.updatedAt) && Number(value.updatedAt) >= 0;
}

function validModel(value: unknown): value is ComposerDraftModelSelection {
  return isRecord(value)
    && hasExactKeys(value, ["provider", "model"])
    && validIdentifier(value.provider)
    && validIdentifier(value.model);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_CHARS;
}

function validThinkingLevel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_THINKING_LEVEL_CHARS;
}

function preferenceWithoutWorkspace(item: StoredRuntimePreference): RecentSessionRuntimePreference {
  return {
    model: { ...item.model },
    ...(item.thinkingLevel ? { thinkingLevel: item.thinkingLevel } : {}),
    updatedAt: item.updatedAt
  };
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function emptyPreferences(): StoredRuntimePreferences {
  return { version: 1, items: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[]
): boolean {
  const allowedKeys = new Set(allowed);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowedKeys.has(key));
}
