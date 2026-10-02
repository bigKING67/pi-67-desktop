import type { TeamChatSearchPage } from "@pi67/domain";
import type { CommandPayloads } from "@pi67/protocol";
import type { StoreApi } from "zustand/vanilla";
import type { TeamChatSearchFilters, TeamChatState } from "./team-chat-model.js";

type Reduce = (state: TeamChatState) => TeamChatState;

/** Message search for the Team Chat controller (ADR 0007): one search at a time, newest wins. */
export function createTeamChatSearch({ request, store, update, since }: {
  request: (payload: CommandPayloads["teamChat.search"]) => Promise<TeamChatSearchPage>;
  store: StoreApi<TeamChatState>;
  update: (reduce: Reduce) => void;
  /** Call before a request; the result applies only if no sign-out or reset happened since. */
  since: () => (reduce: Reduce) => void;
}) {
  let revision = 0;
  const withSearch = (change: (search: NonNullable<TeamChatState["search"]>) => TeamChatState["search"]): Reduce =>
    (state) => state.search ? { ...state, search: change(state.search) } : state;

  return {
    /** Runs a new search and shows its results. */
    async search({ query: raw, conversationId, senderUserId }: TeamChatSearchFilters): Promise<void> {
      const current = ++revision;
      const filters: TeamChatSearchFilters = {
        query: raw.trim(),
        ...(conversationId === undefined ? {} : { conversationId }),
        ...(senderUserId === undefined ? {} : { senderUserId })
      };
      update((state) => ({ ...state, panel: "search", search: { ...filters, status: "loading", results: [], loadingMore: false } }));
      const settle = since();
      try {
        const page = await request(filters);
        if (current !== revision) return;
        settle(withSearch(({ nextCursor: _old, ...search }) => ({
          ...search, status: "ready", results: page.results, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
        })));
      } catch {
        if (current === revision) settle(withSearch((search) => ({ ...search, status: "error" })));
      }
    },
    async loadMoreSearch(): Promise<void> {
      const search = store.getState().search;
      if (!search?.nextCursor || search.loadingMore || search.status !== "ready") return;
      const current = revision;
      const { query, conversationId, senderUserId, nextCursor } = search;
      update(withSearch((value) => ({ ...value, loadingMore: true })));
      const settle = since();
      try {
        const page = await request({
          query, cursor: nextCursor,
          ...(conversationId === undefined ? {} : { conversationId }),
          ...(senderUserId === undefined ? {} : { senderUserId })
        });
        if (current !== revision) return;
        settle(withSearch(({ nextCursor: _old, ...value }) => ({
          ...value, results: [...value.results, ...page.results], loadingMore: false,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
        })));
      } catch {
        if (current === revision) settle(withSearch((value) => ({ ...value, loadingMore: false })));
      }
    },
    /** Back to the last results without searching again. */
    openSearch: () => update((state) => state.search ? { ...state, panel: "search" } : state),
    closeSearch(): void {
      revision += 1;
      update((state) => ({ ...state, search: undefined, panel: state.panel === "search" ? undefined : state.panel }));
    }
  };
}
