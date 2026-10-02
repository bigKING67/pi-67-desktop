import { TEAM_CHAT_DEFAULT_POLICY, type ChatNativeNotificationRequest, type TeamChatActivityItem, type TeamChatDirectory } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { INITIAL_TEAM_CHAT_STATE, type TeamChatState } from "./team-chat-model.js";
import { DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES, type TeamChatNotificationPreferences } from "./team-chat-notification-preferences.js";
import { createTeamChatNotifier } from "./team-chat-notifications.js";

const conversation = (id: string, name: string, patch = {}) => ({
  id, kind: "channel" as const, visibility: "public" as const, name, joined: true, memberCount: 3, memberUserIds: [],
  lastSeq: 9, lastReadSeq: 0, unreadCount: 1, mentionCount: 1, createdAt: 1, ...patch
});
const directory: TeamChatDirectory = {
  teamId: "t", selfUserId: "me",
  members: [{ userId: "me", displayName: "我", role: "member" }, { userId: "u2", displayName: "李雷", role: "member" }],
  conversations: [conversation("c1", "设计"), conversation("c2", "发布", { muted: true }), conversation("c3", "研究"),
    conversation("c4", "运营"), conversation("c5", "销售")],
  policy: TEAM_CHAT_DEFAULT_POLICY, agents: [], bots: []
};
let sequence = 0;
const item = (conversationId: string, patch: Partial<TeamChatActivityItem> = {}): TeamChatActivityItem => {
  sequence += 1;
  return {
    key: `m:00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, kind: "mention", conversationId,
    actorUserId: "u2", messageSeq: sequence, preview: "请看一下发布清单", createdAt: sequence, unread: true, ...patch
  };
};

function harness(options: { viewing?: string; preferences?: Partial<TeamChatNotificationPreferences> } = {}) {
  const store = createStore<TeamChatState>(() => ({ ...INITIAL_TEAM_CHAT_STATE, directory }));
  const shown: ChatNativeNotificationRequest[] = [];
  const dismissed: string[] = [];
  let clock = 1_000;
  const view = { id: options.viewing };
  const notifier = createTeamChatNotifier({
    store,
    show: vi.fn(async (request: ChatNativeNotificationRequest) => { shown.push(request); return true; }),
    dismiss: (id) => dismissed.push(id),
    isViewing: (id) => id === view.id,
    preferences: () => ({ ...DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES, ...options.preferences }),
    now: () => clock
  });
  const stop = notifier.start();
  const setActivity = (activity: TeamChatActivityItem[] | undefined) => store.setState({ activity });
  return { store, shown, dismissed, setActivity, stop, notifier, view, advance: (ms: number) => { clock += ms; } };
}

describe("team chat notifications", () => {
  it("treats the first activity read as the baseline and notifies new unread items without content", () => {
    const { shown, setActivity } = harness();
    const first = item("c1");
    setActivity([first]);
    expect(shown).toEqual([]);
    const next = item("c1");
    setActivity([next, first]);
    expect(shown).toEqual([{ notificationId: expect.stringMatching(/^chat-c1-[0-9a-z]+-\d+$/u), kind: "chat",
      title: "李雷 在 #设计 提到了你", body: "", conversationId: "c1", messageSeq: next.messageSeq }]);
  });

  it("shows the preview only when the user turned it on", () => {
    const { shown, setActivity } = harness({ preferences: { preview: true } });
    setActivity([]);
    const card = item("c3", { kind: "card_review", key: "e:00000000-0000-4000-8000-00000000ffff", cardTitle: "补测试" });
    delete card.preview;
    setActivity([item("c1"), card]);
    expect(shown.map(({ title, body }) => ({ title, body }))).toEqual([
      { title: "李雷 提交了任务卡，等你验收", body: "#研究 · 补测试" },
      { title: "李雷 在 #设计 提到了你", body: "请看一下发布清单" }
    ]);
  });

  it("skips muted conversations, the conversation in view, topics turned off, handled and read items", () => {
    const { shown, setActivity } = harness({ viewing: "c3", preferences: { topics: { ...DEFAULT_TEAM_CHAT_NOTIFICATION_PREFERENCES.topics, dm: false } } });
    setActivity([]);
    setActivity([item("c2"), item("c3"), item("c1", { kind: "dm" }), item("c1", { doneAt: 5 }), item("c1", { unread: false })]);
    expect(shown).toEqual([]);
  });

  it("raises nothing when notifications are off", () => {
    const { shown, setActivity } = harness({ preferences: { enabled: false } });
    setActivity([]);
    setActivity([item("c1")]);
    expect(shown).toEqual([]);
  });

  it("merges a burst in one conversation and starts over after the window", () => {
    const { shown, dismissed, setActivity, store, advance } = harness();
    setActivity([]);
    setActivity([item("c1")]);
    setActivity([item("c1"), ...store.getState().activity!]);
    expect(shown.at(-1)).toMatchObject({ title: "2 条新动态 · #设计", body: "李雷 在 #设计 提到了你" });
    expect(dismissed).toEqual([shown[0]!.notificationId]);
    advance(3 * 60_000);
    setActivity([item("c1"), ...store.getState().activity!]);
    expect(shown.at(-1)?.title).toBe("李雷 在 #设计 提到了你");
  });

  it("summarizes many conversations at once and dismisses what the reader opens", () => {
    const { shown, dismissed, setActivity, notifier, store, view } = harness();
    setActivity([]);
    setActivity([item("c1"), item("c3"), item("c4"), item("c5")]);
    expect(shown).toEqual([expect.objectContaining({ title: "你有 4 条新动态", notificationId: expect.stringMatching(/^chat-summary-/u) })]);
    expect(shown[0]).not.toHaveProperty("conversationId");
    setActivity([item("c1"), ...store.getState().activity!]);
    expect(shown.at(-1)?.conversationId).toBe("c1");
    view.id = "c1";
    notifier.refresh();
    expect(dismissed).toEqual([shown.at(-1)!.notificationId]);
  });

  it("forgets everything when activity is cleared (sign-out)", () => {
    const { shown, dismissed, setActivity } = harness();
    setActivity([]);
    setActivity([item("c1")]);
    setActivity(undefined);
    expect(dismissed).toEqual([shown[0]!.notificationId]);
    setActivity([item("c1")]);
    expect(shown).toHaveLength(1);
  });

  it("does not announce an older item that reappears, such as mentions after rejoining a channel", () => {
    const { shown, setActivity } = harness();
    const old = item("c1");
    const recent = item("c3");
    setActivity([recent]);
    setActivity([recent, old]);
    expect(shown).toEqual([]);
  });

  it("makes notification ids unique per renderer start", () => {
    const first = harness();
    first.setActivity([]);
    first.setActivity([item("c1")]);
    expect(first.shown[0]!.notificationId).toMatch(/^chat-c1-[0-9a-z]+-1$/u);
  });
});
