import type { TeamChatConnectionState, TeamChatVisibility } from "@pi67/domain";
import type { CommandPayloads, CommandResults, TeamChatCommandPayloads } from "@pi67/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
import { messages } from "../localization/message-catalog.js";
import {
  addPending,
  applyMessage,
  applyMessagePage,
  applyPush,
  applyReadCursor,
  directMessageWith,
  failPending,
  INITIAL_TEAM_CHAT_STATE,
  removePending,
  replaceDirectory,
  setThreadStatus,
  upsertConversation,
  type TeamChatState
} from "./team-chat-model.js";

type TeamChatCommandType = keyof TeamChatCommandPayloads;

export interface TeamChatPort {
  request<T extends TeamChatCommandType>(type: T, payload: CommandPayloads[T]): Promise<CommandResults[T]>;
  subscribe(subscriber: ConnectionSubscriber): () => void;
  newClientKey(): string;
}

/** Newer pages fetched while reconciling one thread before reloading its latest page instead. */
const MAX_CATCH_UP_PAGES = 5;

export function createTeamChatController(port: TeamChatPort, store: StoreApi<TeamChatState> = createStore(() => INITIAL_TEAM_CHAT_STATE)) {
  let unsubscribe: (() => void) | undefined;
  let epoch = 0;
  let directoryRequest: Promise<void> | undefined;
  let directoryAgain = false;
  let lastLiveGeneration = 0;

  const update = (reduce: (state: TeamChatState) => TeamChatState) => store.setState(reduce(store.getState()), true);
  /** Applies a late result only if no sign-out or reset happened since the request began. */
  const guarded = (reduce: (state: TeamChatState) => TeamChatState) => {
    const started = epoch;
    return () => { if (started === epoch) update(reduce); };
  };

  function reset(connection: TeamChatConnectionState | undefined): void {
    epoch += 1;
    lastLiveGeneration = 0;
    store.setState({ ...INITIAL_TEAM_CHAT_STATE, connection }, true);
  }

  function onConnection(connection: TeamChatConnectionState): void {
    if (connection.status === "signed-out") {
      if (store.getState().connection?.status !== "signed-out") reset(connection);
      return;
    }
    update((state) => ({ ...state, connection }));
    if (connection.status === "live" && connection.generation !== lastLiveGeneration) {
      lastLiveGeneration = connection.generation;
      void reconcile();
    } else if (connection.status !== "unavailable" && store.getState().directoryStatus === "idle") {
      void loadDirectory();
    }
  }

  async function refreshConnection(): Promise<void> {
    try {
      onConnection(await port.request("teamChat.connection.get", {}));
    } catch {
      update((state) => ({ ...state, connection: undefined }));
    }
  }

  function loadDirectory(): Promise<void> {
    if (directoryRequest) {
      directoryAgain = true;
      return directoryRequest;
    }
    if (!store.getState().directory) update((state) => ({ ...state, directoryStatus: "loading" }));
    directoryRequest = (async () => {
      do {
        directoryAgain = false;
        const started = epoch;
        try {
          const directory = await port.request("teamChat.directory.get", {});
          if (started === epoch) update((state) => replaceDirectory(state, directory));
        } catch {
          if (started === epoch) update((state) => ({ ...state, directoryStatus: state.directory ? "ready" : "error" }));
        }
      } while (directoryAgain);
    })().finally(() => { directoryRequest = undefined; });
    return directoryRequest;
  }

  async function reconcile(): Promise<void> {
    await loadDirectory();
    const { threads, selectedConversationId } = store.getState();
    await Promise.all(Object.keys(threads).map((id) => catchUp(id)));
    if (selectedConversationId) await markRead(selectedConversationId);
  }

  async function loadLatest(conversationId: string): Promise<void> {
    update((state) => setThreadStatus(state, conversationId, { status: "loading" }));
    try {
      const page = await port.request("teamChat.messages.list", { conversationId });
      guarded((state) => applyMessagePage(state, conversationId, page, "latest"))();
    } catch {
      guarded((state) => setThreadStatus(state, conversationId, { status: "error" }))();
    }
  }

  /** Fetches newer messages; `from` overrides the first cursor when a push skipped ahead of the loaded tail. */
  async function catchUp(conversationId: string, from?: number): Promise<void> {
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
      const thread = store.getState().threads[conversationId];
      if (!thread || thread.status !== "ready") return;
      const tail = page === 0 && from !== undefined ? from : thread.messages.at(-1)?.seq ?? 0;
      try {
        const result = await port.request("teamChat.messages.list", { conversationId, after: tail, limit: 100 });
        guarded((state) => applyMessagePage(state, conversationId, result, "newer"))();
        if (!result.hasMore) return;
      } catch {
        return;
      }
    }
    await loadLatest(conversationId);
  }

  async function loadOlder(conversationId: string): Promise<void> {
    const thread = store.getState().threads[conversationId];
    const first = thread?.messages[0]?.seq;
    if (!thread || thread.loadingOlder || !thread.hasMore || first === undefined) return;
    update((state) => setThreadStatus(state, conversationId, { loadingOlder: true }));
    try {
      const page = await port.request("teamChat.messages.list", { conversationId, before: first });
      guarded((state) => applyMessagePage(state, conversationId, page, "older"))();
    } catch {
      guarded((state) => setThreadStatus(state, conversationId, { loadingOlder: false }))();
    }
  }

  async function markRead(conversationId: string): Promise<void> {
    const conversation = store.getState().directory?.conversations.find((item) => item.id === conversationId);
    if (!conversation?.joined || conversation.lastReadSeq >= conversation.lastSeq) return;
    update((state) => applyReadCursor(state, conversationId, conversation.lastSeq));
    try {
      await port.request("teamChat.read.mark", { conversationId, lastReadSeq: conversation.lastSeq });
    } catch {
      // The next directory read restores the authoritative cursor.
    }
  }

  async function deliver(conversationId: string, clientKey: string, body: string): Promise<void> {
    try {
      const message = await port.request("teamChat.message.send", { conversationId, clientKey, body });
      guarded((state) => applyMessage(state, message))();
    } catch (error) {
      guarded((state) => failPending(state, clientKey, teamChatErrorMessage(error)))();
    }
  }

  async function selectConversation(conversationId: string | undefined): Promise<void> {
    update((state) => ({ ...state, selectedConversationId: conversationId }));
    if (conversationId === undefined) return;
    const thread = store.getState().threads[conversationId];
    if (!thread || thread.status === "error") await loadLatest(conversationId);
    await markRead(conversationId);
  }

  return {
    store,
    start(): void {
      if (unsubscribe) return;
      unsubscribe = port.subscribe({
        onConnected: () => { void refreshConnection(); },
        onTeardown: () => update((state) => ({ ...state, connection: undefined })),
        onSequenceGap: () => { void refreshConnection().then(() => reconcile()); },
        onEvent: (event, envelope) => {
          if (envelope.context.scope !== "app") return;
          if (event.type === "teamChat.connectionChanged") onConnection(event.payload);
          if (event.type !== "teamChat.pushed") return;
          const before = event.payload.type === "message.created"
            ? store.getState().threads[event.payload.message.conversationId]?.messages.at(-1)?.seq
            : undefined;
          const result = applyPush(store.getState(), event.payload);
          store.setState(result.state, true);
          if (result.refreshDirectory) void loadDirectory();
          if (event.payload.type === "message.created" && before !== undefined && event.payload.message.seq > before + 1) {
            void catchUp(event.payload.message.conversationId, before);
          }
        }
      });
    },
    /** Entering Chat starts the on-demand Host connection when nothing is known yet. */
    activate(): void {
      if (store.getState().connection === undefined) void refreshConnection();
    },
    stop(): void {
      unsubscribe?.();
      unsubscribe = undefined;
      reset(undefined);
    },
    retryDirectory: () => loadDirectory(),
    loadOlder,
    markRead,
    selectConversation,
    reloadThread: loadLatest,
    async send(conversationId: string, body: string): Promise<void> {
      const clientKey = port.newClientKey();
      update((state) => addPending(state, { clientKey, conversationId, body, createdAt: Date.now(), status: "sending" }));
      await deliver(conversationId, clientKey, body);
    },
    async retrySend(clientKey: string): Promise<void> {
      const pending = store.getState().pending.find((item) => item.clientKey === clientKey);
      if (!pending || pending.status !== "failed") return;
      update((state) => addPending(state, { ...pending, status: "sending" }));
      await deliver(pending.conversationId, clientKey, pending.body);
    },
    discardPending: (clientKey: string) => update((state) => removePending(state, clientKey)),
    async openDirectMessage(userId: string): Promise<void> {
      const existing = directMessageWith(store.getState().directory, userId);
      const conversation = existing ?? await port.request("teamChat.dm.open", { userId });
      if (!existing) guarded((state) => upsertConversation(state, conversation))();
      await selectConversation(conversation.id);
    },
    async createChannel(input: { name: string; visibility: TeamChatVisibility; memberUserIds: string[] }): Promise<void> {
      const conversation = await port.request("teamChat.channel.create", input);
      guarded((state) => upsertConversation(state, conversation))();
      await selectConversation(conversation.id);
    },
    async joinChannel(conversationId: string): Promise<void> {
      const conversation = await port.request("teamChat.channel.join", { conversationId });
      guarded((state) => upsertConversation(state, conversation))();
      await loadLatest(conversationId);
    }
  };
}

/** Specific copy for known New Money rejections; never echoes raw service text. */
export function teamChatErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "details" in error
    ? (error as { details?: Record<string, unknown> }).details?.serviceError
    : undefined;
  return (typeof code === "string" ? messages.teamChat.errors[code] : undefined) ?? messages.teamChat.genericError;
}
