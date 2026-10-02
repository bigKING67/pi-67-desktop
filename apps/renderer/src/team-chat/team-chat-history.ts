import { TEAM_CHAT_PAGE_MAX } from "@pi67/domain";
import type { StoreApi } from "zustand/vanilla";
import { applyMessagePage, setThreadStatus, type TeamChatState } from "./team-chat-model.js";
import type { TeamChatPort } from "./team-chat-controller.js";

type Reduce = (state: TeamChatState) => TeamChatState;

/** Newer pages fetched while reconciling one thread before reloading its latest page instead. */
const MAX_CATCH_UP_PAGES = 5;
/** Older pages walked to reach a nearby message; anything further opens a window around it. */
const MAX_REVEAL_PAGES = 3;
/** The service's default history page. */
const TEAM_CHAT_PAGE_SIZE = 50;
/** Messages after the target in a window, so it can sit in the middle of the view. */
const WINDOW_AFTER = 25;

/** Conversation history paging for the Team Chat controller: latest, older, newer and windows. */
export function createTeamChatHistory({ port, store, update, since }: {
  port: Pick<TeamChatPort, "request">;
  store: StoreApi<TeamChatState>;
  update: (reduce: Reduce) => void;
  /** Call before a request; the result applies only if no sign-out or reset happened since. */
  since: () => (reduce: Reduce) => void;
}) {
  async function loadLatest(conversationId: string): Promise<void> {
    const settle = since();
    update((state) => setThreadStatus(state, conversationId, { status: "loading" }));
    try {
      const page = await port.request("teamChat.messages.list", { conversationId });
      settle((state) => applyMessagePage(state, conversationId, page, "latest"));
    } catch {
      settle((state) => setThreadStatus(state, conversationId, { status: "error" }));
    }
  }

  /** Fetches newer messages; `from` overrides the first cursor when a push skipped ahead of the loaded tail. */
  async function catchUp(conversationId: string, from?: number): Promise<void> {
    const settle = since();
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
      const thread = store.getState().threads[conversationId];
      // A window at older history catches up by scrolling (loadNewer), not by jumping.
      if (!thread || thread.status !== "ready" || thread.hasNewer) return;
      const tail = page === 0 && from !== undefined ? from : thread.messages.at(-1)?.seq ?? 0;
      try {
        const result = await port.request("teamChat.messages.list", { conversationId, after: tail, limit: 100 });
        settle((state) => applyMessagePage(state, conversationId, result, "newer"));
        if (!result.hasMore) return;
      } catch {
        return;
      }
    }
    await loadLatest(conversationId);
  }

  async function loadOlder(conversationId: string): Promise<void> {
    const settle = since();
    const thread = store.getState().threads[conversationId];
    const first = thread?.messages[0]?.seq;
    if (!thread || thread.loadingOlder || !thread.hasMore || first === undefined) return;
    update((state) => setThreadStatus(state, conversationId, { loadingOlder: true }));
    try {
      const page = await port.request("teamChat.messages.list", { conversationId, before: first });
      settle((state) => applyMessagePage(state, conversationId, page, "older"));
    } catch {
      settle((state) => setThreadStatus(state, conversationId, { loadingOlder: false }));
    }
  }

  /** Brings `seq` into the thread: a few older pages when near, else a window around it. */
  async function reveal(conversationId: string, seq: number): Promise<void> {
    const settle = since();
    for (let page = 0; page < MAX_REVEAL_PAGES; page += 1) {
      const thread = store.getState().threads[conversationId];
      const first = thread?.messages[0]?.seq;
      if (!thread || thread.status !== "ready" || !thread.hasMore || first === undefined || first <= seq) return;
      if (first - seq > TEAM_CHAT_PAGE_SIZE * (MAX_REVEAL_PAGES - page)) break;
      await loadOlder(conversationId);
    }
    const thread = store.getState().threads[conversationId];
    if (!thread || thread.status !== "ready" || (thread.messages[0]?.seq ?? 0) <= seq) return;
    try {
      const page = await port.request("teamChat.messages.list", { conversationId, before: seq + WINDOW_AFTER + 1, limit: TEAM_CHAT_PAGE_SIZE });
      settle((state) => applyMessagePage(state, conversationId, page, "window"));
    } catch {
      // The conversation stays at its newest messages.
    }
  }

  /** Next newer page for a window opened at older history. */
  const newerInFlight = new Set<string>();
  async function loadNewer(conversationId: string): Promise<void> {
    const thread = store.getState().threads[conversationId];
    const tail = thread?.messages.at(-1)?.seq;
    if (!thread?.hasNewer || tail === undefined || newerInFlight.has(conversationId)) return;
    newerInFlight.add(conversationId);
    const settle = since();
    try {
      const page = await port.request("teamChat.messages.list", { conversationId, after: tail, limit: TEAM_CHAT_PAGE_MAX });
      settle((state) => applyMessagePage(state, conversationId, page, "newer"));
    } catch {
      // Scrolling down again retries.
    } finally {
      newerInFlight.delete(conversationId);
    }
  }

  /**
   * After a reconnect: re-reads the history already loaded so edits and recalls made
   * while away replace their text (ADR 0008); a long range reloads the latest page.
   */
  async function refreshLoaded(conversationId: string): Promise<void> {
    const settle = since();
    const thread = store.getState().threads[conversationId];
    const first = thread?.messages[0]?.seq;
    const last = thread?.messages.at(-1)?.seq;
    if (!thread || thread.status !== "ready" || first === undefined || last === undefined) return;
    if (last - first >= TEAM_CHAT_PAGE_MAX * MAX_CATCH_UP_PAGES) {
      await loadLatest(conversationId);
      return;
    }
    for (let after = first - 1; after < last;) {
      try {
        const page = await port.request("teamChat.messages.list", { conversationId, after, limit: TEAM_CHAT_PAGE_MAX });
        settle((state) => applyMessagePage(state, conversationId, { messages: page.messages.filter((item) => item.seq <= last) }, "refresh"));
        const tail = page.messages.at(-1)?.seq;
        if (!page.hasMore || tail === undefined) return;
        after = tail;
      } catch {
        return;
      }
    }
  }

  return { loadLatest, catchUp, loadOlder, loadNewer, reveal, refreshLoaded };
}
