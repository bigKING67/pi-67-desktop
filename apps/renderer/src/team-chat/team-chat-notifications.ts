import type { ChatNativeNotificationRequest, TeamChatActivityItem } from "@pi67/domain";
import type { StoreApi } from "zustand/vanilla";
import { messages } from "../localization/message-catalog.js";
import { activityNotificationText } from "./team-chat-activity-presentation.js";
import type { TeamChatState } from "./team-chat-model.js";
import {
  teamChatNotificationPreferences,
  teamChatNotificationTopic,
  type TeamChatNotificationPreferences
} from "./team-chat-notification-preferences.js";

/** A later item in the same conversation within this window replaces the earlier notification. */
const MERGE_WINDOW_MS = 2 * 60_000;
/** More conversations than this in one pass (a reconnect) become one summary notification. */
const MAX_CONVERSATIONS_PER_PASS = 3;

export interface TeamChatNotifierPorts {
  store: StoreApi<TeamChatState>;
  show(request: ChatNativeNotificationRequest): Promise<boolean>;
  dismiss(notificationId: string): void;
  /** The window is focused and Chat shows this conversation. */
  isViewing(conversationId: string): boolean;
  preferences?: () => TeamChatNotificationPreferences;
  now?: () => number;
}

interface Shown {
  notificationId: string;
  items: TeamChatActivityItem[];
  at: number;
}

/**
 * Raises system notifications for new activity (ADR 0006). The first activity read is
 * the baseline; afterwards every new, unread, unhandled item whose topic is on and
 * whose conversation is neither muted nor in view becomes a notification.
 */
export function createTeamChatNotifier(ports: TeamChatNotifierPorts) {
  const preferences = ports.preferences ?? teamChatNotificationPreferences;
  const now = ports.now ?? Date.now;
  const shown = new Map<string, Shown>();
  let known: Set<string> | undefined;
  let lastActivity: TeamChatState["activity"];
  let counter = 0;
  /** Main dedupes ids for the app's life; a reopened window starts a new renderer and counter. */
  const instance = Math.floor(now()).toString(36);
  /** Newest item time seen so far: an older item that reappears (rejoined channel) is not news. */
  let newest = 0;

  function forget(conversationId: string): void {
    const entry = shown.get(conversationId);
    if (!entry) return;
    shown.delete(conversationId);
    ports.dismiss(entry.notificationId);
  }

  function present(
    key: string,
    items: TeamChatActivityItem[],
    text: { title: string; body: string },
    target: Pick<ChatNativeNotificationRequest, "conversationId" | "messageSeq">
  ): void {
    counter += 1;
    const notificationId = `chat-${key}-${instance}-${counter}`;
    shown.set(key, { notificationId, items, at: now() });
    void ports.show({ notificationId, kind: "chat", ...text, ...target }).then((ok) => {
      if (!ok && shown.get(key)?.notificationId === notificationId) shown.delete(key);
    }, () => undefined);
  }

  function notify(fresh: readonly TeamChatActivityItem[], state: TeamChatState): void {
    const settings = preferences();
    if (!settings.enabled) return;
    const groups = new Map<string, TeamChatActivityItem[]>();
    for (const item of [...fresh].reverse()) {
      if (!settings.topics[teamChatNotificationTopic(item.kind)]) continue;
      const conversation = state.directory?.conversations.find((candidate) => candidate.id === item.conversationId);
      if (conversation?.muted || ports.isViewing(item.conversationId)) continue;
      groups.set(item.conversationId, [...groups.get(item.conversationId) ?? [], item]);
    }
    if (groups.size > MAX_CONVERSATIONS_PER_PASS) {
      const count = [...groups.values()].reduce((total, items) => total + items.length, 0);
      for (const conversationId of groups.keys()) forget(conversationId);
      forget("summary");
      present("summary", [], { title: messages.teamChat.activitySummary(count), body: messages.teamChat.activitySummaryBody }, {});
      return;
    }
    for (const [conversationId, items] of groups) {
      const previous = shown.get(conversationId);
      const merged = previous && now() - previous.at < MERGE_WINDOW_MS ? [...previous.items, ...items] : items;
      forget(conversationId);
      const latest = merged.at(-1)!;
      present(conversationId, merged, activityNotificationText(merged, state.directory, settings.preview), {
        conversationId,
        ...(latest.messageSeq === undefined ? {} : { messageSeq: latest.messageSeq })
      });
    }
  }

  function observe(state: TeamChatState): void {
    for (const conversationId of shown.keys()) {
      if (ports.isViewing(conversationId)) forget(conversationId);
    }
    if (state.activity === lastActivity) return;
    lastActivity = state.activity;
    if (!state.activity) {
      known = undefined;
      newest = 0;
      for (const conversationId of shown.keys()) forget(conversationId);
      return;
    }
    const keys = new Set(state.activity.map((item) => item.key));
    const previous = known;
    const floor = newest;
    known = keys;
    for (const item of state.activity) newest = Math.max(newest, item.createdAt);
    if (!previous) return;
    const fresh = state.activity.filter((item) => !previous.has(item.key) && item.createdAt > floor
      && item.unread && item.doneAt === undefined);
    if (fresh.length > 0) notify(fresh, state);
  }

  return {
    start: (): (() => void) => {
      observe(ports.store.getState());
      return ports.store.subscribe(observe);
    },
    /** Re-checks visibility, for window focus changes the store does not see. */
    refresh: () => observe(ports.store.getState()),
    /** A clicked notification is gone; forget it so a later item starts fresh. */
    activated: (conversationId: string | undefined): void => {
      shown.delete(conversationId ?? "summary");
    }
  };
}
