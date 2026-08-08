import type { LucideIcon } from "lucide-react";
import { appLocale, messages } from "../localization/message-catalog.js";

type PaletteGroupId = "recent" | "sessions" | "messages" | "extensions" | "actions" | "settings";

export interface PaletteAction {
  id: string;
  group: Exclude<PaletteGroupId, "recent">;
  label: string;
  detail: string;
  keywords: string;
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  run: () => Promise<void> | void;
}

export interface PaletteGroup {
  id: PaletteGroupId;
  label: string;
  items: PaletteAction[];
}

export interface PaletteProjection {
  groups: PaletteGroup[];
  totalMatchCount: number;
  visibleMatchCount: number;
  truncated: boolean;
}

export const MAX_QUERY_LENGTH = 80;
export const MAX_SESSION_CANDIDATES = 400;
export const MAX_EXTENSION_CANDIDATES = 150;
export const MAX_VISIBLE_SEARCH_RESULTS = 60;

const MAX_MATCH_TEXT_LENGTH = 512;
const MAX_RECENT_ITEMS = 6;

const GROUP_LABELS: Readonly<Record<PaletteGroupId, string>> = {
  recent: messages.commandPalette.groupRecent,
  sessions: messages.commandPalette.groupSessions,
  messages: messages.commandPalette.groupMessages,
  extensions: messages.commandPalette.groupExtensions,
  actions: messages.commandPalette.groupActions,
  settings: messages.commandPalette.groupSettings
};

const GROUP_ORDER: ReadonlyArray<Exclude<PaletteGroupId, "recent">> = [
  "sessions",
  "messages",
  "extensions",
  "actions",
  "settings"
];

const EMPTY_QUERY_LIMITS: Readonly<Record<Exclude<PaletteGroupId, "recent">, number>> = {
  sessions: 12,
  messages: 0,
  extensions: 12,
  actions: 20,
  settings: 10
};

export function buildPaletteProjection(
  actions: readonly PaletteAction[],
  query: string,
  recentActionIds: readonly string[] = []
): PaletteProjection {
  const normalizedQuery = normalizePaletteQuery(query);
  if (normalizedQuery) return searchProjection(actions, normalizedQuery);

  const byId = new Map(actions.map((action) => [action.id, action]));
  const recentItems = recentActionIds
    .map((id) => byId.get(id))
    .filter((item): item is PaletteAction => item !== undefined)
    .slice(0, MAX_RECENT_ITEMS);
  const recentIds = new Set(recentItems.map((item) => item.id));
  const groups: PaletteGroup[] = recentItems.length > 0
    ? [{ id: "recent", label: GROUP_LABELS.recent, items: recentItems }]
    : [];
  for (const groupId of GROUP_ORDER) {
    const items = actions
      .filter((action) => action.group === groupId && !recentIds.has(action.id))
      .slice(0, EMPTY_QUERY_LIMITS[groupId]);
    if (items.length > 0) groups.push({ id: groupId, label: GROUP_LABELS[groupId], items });
  }
  const visibleMatchCount = groups.reduce((count, group) => count + group.items.length, 0);
  return {
    groups,
    totalMatchCount: actions.length,
    visibleMatchCount,
    truncated: visibleMatchCount < actions.length
  };
}

function normalizePaletteQuery(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase(appLocale).replace(/\s+/gu, " ");
}

function searchProjection(actions: readonly PaletteAction[], query: string): PaletteProjection {
  const matches = actions
    .map((action) => ({ action, score: fuzzyScore(query, action) }))
    .filter((candidate): candidate is { action: PaletteAction; score: number } => candidate.score !== undefined)
    .sort((left, right) => (
      right.score - left.score || left.action.label.localeCompare(right.action.label, appLocale)
    ));
  const visible = matches.slice(0, MAX_VISIBLE_SEARCH_RESULTS);
  const groups = GROUP_ORDER.map((groupId) => ({
    id: groupId,
    label: GROUP_LABELS[groupId],
    items: visible.filter((match) => match.action.group === groupId).map((match) => match.action)
  })).filter((group) => group.items.length > 0);
  return {
    groups,
    totalMatchCount: matches.length,
    visibleMatchCount: visible.length,
    truncated: matches.length > visible.length
  };
}

function fuzzyScore(query: string, action: PaletteAction): number | undefined {
  const label = normalizePaletteQuery(action.label).slice(0, MAX_MATCH_TEXT_LENGTH);
  const searchable = normalizePaletteQuery(`${action.label} ${action.detail} ${action.keywords}`)
    .slice(0, MAX_MATCH_TEXT_LENGTH);
  if (label === query) return 1_000;
  const labelIndex = label.indexOf(query);
  if (labelIndex >= 0) return 900 - labelIndex;
  const textIndex = searchable.indexOf(query);
  if (textIndex >= 0) return 700 - Math.min(textIndex, 200);
  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => searchable.includes(token))) return 550 - tokens.length;

  let queryIndex = 0;
  let gapPenalty = 0;
  let previousMatch = -1;
  for (let index = 0; index < searchable.length && queryIndex < query.length; index += 1) {
    if (searchable[index] !== query[queryIndex]) continue;
    if (previousMatch >= 0) gapPenalty += index - previousMatch - 1;
    previousMatch = index;
    queryIndex += 1;
  }
  return queryIndex === query.length ? 350 - Math.min(gapPenalty, 300) : undefined;
}
