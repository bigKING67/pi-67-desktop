import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES,
  resetTeamChatNotificationPreferencesForTests,
  teamChatNotificationPreferences,
  teamChatNotificationTopic,
  updateTeamChatNotificationPreferences
} from "./team-chat-notification-preferences.js";

const STORAGE_KEY = "pi67.team-chat-notifications.v1";

const stored = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); }
    }
  });
});

afterEach(() => {
  stored.clear();
  vi.unstubAllGlobals();
  resetTeamChatNotificationPreferencesForTests();
});

describe("team chat notification preferences", () => {
  it("defaults to notifications on and previews off", () => {
    expect(teamChatNotificationPreferences()).toEqual(DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES);
    expect(DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES.preview).toBe(false);
  });

  it("persists changes per topic and restores them", () => {
    updateTeamChatNotificationPreferences({ topics: { dm: false }, preview: true });
    resetTeamChatNotificationPreferencesForTests();
    expect(teamChatNotificationPreferences()).toEqual({
      enabled: true, preview: true, topics: { mention: true, dm: false, agent: true, card: true }
    });
  });

  it("falls back to defaults for malformed storage", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, enabled: "yes", preview: false, topics: {} }));
    expect(teamChatNotificationPreferences()).toEqual(DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES);
  });

  it("groups activity kinds into topics", () => {
    expect(["mention", "dm", "agent_reply", "agent_failed", "card_review"].map((kind) => teamChatNotificationTopic(kind as never)))
      .toEqual(["mention", "dm", "agent", "agent", "card"]);
  });
});
