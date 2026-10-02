import { useSyncExternalStore } from "react";
import type { TeamChatActivityKind } from "@pi67/domain";

/** Which activity raises a system notification on this device (ADR 0006). */
export type TeamChatNotificationTopic = "mention" | "dm" | "agent" | "card";

export interface TeamChatNotificationPreferences {
  enabled: boolean;
  topics: Readonly<Record<TeamChatNotificationTopic, boolean>>;
  /** Off by default: notifications say who and where, never what. */
  preview: boolean;
}

export const TEAM_CHAT_NOTIFICATION_TOPICS: readonly TeamChatNotificationTopic[] = ["mention", "dm", "agent", "card"];

export const DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES: TeamChatNotificationPreferences = Object.freeze({
  enabled: true,
  topics: Object.freeze({ mention: true, dm: true, agent: true, card: true }),
  preview: false
});

const STORAGE_KEY = "pi67.team-chat-notifications.v1";
const listeners = new Set<() => void>();
let current: TeamChatNotificationPreferences | undefined;

export function teamChatNotificationTopic(kind: TeamChatActivityKind): TeamChatNotificationTopic {
  switch (kind) {
    case "mention":
      return "mention";
    case "dm":
      return "dm";
    case "agent_reply":
    case "agent_failed":
      return "agent";
    case "card_assigned":
    case "card_review":
    case "card_changes_requested":
      return "card";
  }
}

export function teamChatNotificationPreferences(): TeamChatNotificationPreferences {
  current ??= readStored();
  return current;
}

export function useTeamChatNotificationPreferences(): TeamChatNotificationPreferences {
  return useSyncExternalStore(subscribe, teamChatNotificationPreferences, teamChatNotificationPreferences);
}

export function updateTeamChatNotificationPreferences(
  change: Partial<Omit<TeamChatNotificationPreferences, "topics">> & { topics?: Partial<Record<TeamChatNotificationTopic, boolean>> }
): void {
  const previous = teamChatNotificationPreferences();
  current = Object.freeze({
    enabled: change.enabled ?? previous.enabled,
    topics: Object.freeze({ ...previous.topics, ...change.topics }),
    preview: change.preview ?? previous.preview
  });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...current }));
  } catch {
    // Storage may be unavailable; the choice still applies for this run.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStored(): TeamChatNotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseStored(JSON.parse(raw) as unknown) ?? DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES
      : DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES;
  } catch {
    return DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES;
  }
}

function parseStored(value: unknown): TeamChatNotificationPreferences | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const topics = record.topics as Record<string, unknown> | null | undefined;
  if (record.version !== 1 || typeof record.enabled !== "boolean" || typeof record.preview !== "boolean"
    || typeof topics !== "object" || topics === null
    || !TEAM_CHAT_NOTIFICATION_TOPICS.every((topic) => typeof topics[topic] === "boolean")) return undefined;
  return Object.freeze({
    enabled: record.enabled,
    topics: Object.freeze(Object.fromEntries(TEAM_CHAT_NOTIFICATION_TOPICS.map((topic) => [topic, topics[topic] === true])) as
      Record<TeamChatNotificationTopic, boolean>),
    preview: record.preview
  });
}

export function resetTeamChatNotificationPreferencesForTests(): void {
  current = undefined;
}
