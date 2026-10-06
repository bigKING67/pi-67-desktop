import type {
  TeamChatAgentBinding,
  TeamChatAttachment,
  TeamChatChannelAction,
  TeamChatChannelRoster,
  TeamChatConnectionState,
  TeamChatVisibility,
  TeamChatWorkCard,
  TeamChatWorkCardAction,
  TeamChatWorkCardRef
} from "@pi67/domain";
import type { CommandPayloads, CommandResults, TeamChatCommandPayloads } from "@pi67/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
import { messages } from "../localization/message-catalog.js";
import {
  addPending,
  applyActivityDone,
  applyActivityRead,
  applyMessage,
  applyMessageUpdate,
  applyPush,
  applyReadCursor,
  applyWorkCard,
  directMessageWith,
  failPending,
  INITIAL_TEAM_CHAT_STATE,
  removePending,
  replaceDirectory,
  upsertConversation,
  type TeamChatPendingMessage,
  type TeamChatState
} from "./team-chat-model.js";
import { createTeamChatHistory } from "./team-chat-history.js";
import { createTeamChatSearch } from "./team-chat-search-controller.js";

type TeamChatCommandType = keyof TeamChatCommandPayloads;

export interface TeamChatPort {
  request<T extends TeamChatCommandType>(type: T, payload: CommandPayloads[T]): Promise<CommandResults[T]>;
  subscribe(subscriber: ConnectionSubscriber): () => void;
  newClientKey(): string;
}

/** Runs `load` one pass at a time; calls during a pass schedule exactly one more. */
function coalesced(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await load();
      } while (again);
    })().finally(() => { running = undefined; });
    return running;
  };
}

export function createTeamChatController(port: TeamChatPort, store: StoreApi<TeamChatState> = createStore(() => INITIAL_TEAM_CHAT_STATE)) {
  let unsubscribe: (() => void) | undefined;
  let epoch = 0;
  let lastLiveGeneration = 0;
  let focusRevision = 0;

  const update = (reduce: (state: TeamChatState) => TeamChatState) => store.setState(reduce(store.getState()), true);
  /**
   * Call before a request: the returned function applies a late result only if no
   * sign-out or reset happened since then.
   */
  const since = () => {
    const started = epoch;
    return (reduce: (state: TeamChatState) => TeamChatState) => { if (started === epoch) update(reduce); };
  };
  const { loadLatest, catchUp, loadOlder, loadNewer, reveal, refreshLoaded } = createTeamChatHistory({ port, store, update, since });

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
      void loadActivity();
    }
  }

  async function refreshConnection(): Promise<void> {
    try {
      onConnection(await port.request("teamChat.connection.get", {}));
    } catch {
      update((state) => ({ ...state, connection: undefined }));
    }
  }

  const loadDirectory = coalesced(async () => {
    const started = epoch;
    if (!store.getState().directory) update((state) => ({ ...state, directoryStatus: "loading" }));
    try {
      const directory = await port.request("teamChat.directory.get", {});
      if (started === epoch) update((state) => replaceDirectory(state, directory));
    } catch {
      if (started === epoch) update((state) => ({ ...state, directoryStatus: state.directory ? "ready" : "error" }));
    }
  });

  /** The reader's activity (ADR 0006); re-read on every activity.changed push and reconnect. */
  const loadActivity = coalesced(async () => {
    const started = epoch;
    if (!store.getState().activity) update((state) => ({ ...state, activityStatus: "loading" }));
    try {
      const { items } = await port.request("teamChat.activity.list", {});
      if (started === epoch) update((state) => ({ ...state, activity: items, activityStatus: "ready" }));
    } catch {
      if (started === epoch) update((state) => ({ ...state, activityStatus: state.activity ? "ready" : "error" }));
    }
  });

  /** Loads older pages until `seq` is in the thread, within a bound. */
  async function reconcile(): Promise<void> {
    void loadActivity();
    await loadDirectory();
    const { threads, selectedConversationId } = store.getState();
    await Promise.all(Object.keys(threads).map(async (id) => {
      await refreshLoaded(id);
      await catchUp(id);
    }));
    if (selectedConversationId) await markRead(selectedConversationId);
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

  async function deliver(pending: TeamChatPendingMessage): Promise<void> {
    const { conversationId, clientKey, body, mentionUserIds = [], attachments = [] } = pending;
    const settle = since();
    try {
      const message = await port.request("teamChat.message.send", {
        conversationId, clientKey, body,
        ...(mentionUserIds.length === 0 ? {} : { mentionUserIds: [...mentionUserIds] }),
        ...(attachments.length === 0 ? {} : { attachmentIds: attachments.map((item) => item.id) })
      });
      settle((state) => applyMessage(state, message));
    } catch (error) {
      settle((state) => failPending(state, clientKey, teamChatErrorMessage(error)));
    }
  }

  /** Returns the direct message with a teammate without changing the selection. */
  async function ensureDirectMessage(userId: string): Promise<string> {
    const settle = since();
    const existing = directMessageWith(store.getState().directory, userId);
    if (existing) return existing.id;
    const conversation = await port.request("teamChat.dm.open", { userId });
    settle((state) => upsertConversation(state, conversation));
    return conversation.id;
  }

  async function selectConversation(conversationId: string | undefined): Promise<void> {
    // A focus request belongs to one opening; openMessage sets it again afterwards.
    update((state) => ({ ...state, selectedConversationId: conversationId, panel: undefined, focus: undefined,
      editing: state.editing?.conversationId === conversationId ? state.editing : undefined }));
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
        onTeardown: () => {
          // A restarted Host counts realtime generations from 1 again; its first live state must reconcile.
          lastLiveGeneration = 0;
          update((state) => ({ ...state, connection: undefined }));
        },
        onSequenceGap: () => { void refreshConnection().then(() => reconcile()); },
        onEvent: (event, envelope) => {
          if (envelope.context.scope !== "app") return;
          if (event.type === "teamChat.connectionChanged") onConnection(event.payload);
          if (event.type === "teamChat.agentHostChanged") update((state) => ({ ...state, agentHost: event.payload }));
          if (event.type !== "teamChat.pushed") return;
          const before = event.payload.type === "message.created"
            ? store.getState().threads[event.payload.message.conversationId]?.messages.at(-1)?.seq
            : undefined;
          const result = applyPush(store.getState(), event.payload);
          store.setState(result.state, true);
          if (result.refreshDirectory) void loadDirectory();
          if (result.refreshActivity) void loadActivity();
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
    retryActivity: () => loadActivity(),
    openActivity: () => update((state) => ({ ...state, panel: "activity" })),
    ...createTeamChatSearch({ request: (payload) => port.request("teamChat.search", payload), store, update, since }),
    /** Opens a conversation at one message, as activity items and notifications do. */
    async openMessage(conversationId: string, seq?: number): Promise<void> {
      await selectConversation(conversationId);
      if (seq === undefined) return;
      // Set first, so a window opened by reveal mounts already centred on the message.
      focusRevision += 1;
      update((state) => ({ ...state, focus: { conversationId, seq, revision: focusRevision } }));
      await reveal(conversationId, seq);
    },
    /** Optimistic; a failed request re-reads the activity before rethrowing. */
    async setActivityDone(keys: readonly string[], done: boolean): Promise<void> {
      update((state) => applyActivityDone(state, keys, done, Date.now()));
      try {
        await port.request("teamChat.activity.setDone", { keys: [...keys], done });
      } catch (error) {
        void loadActivity();
        throw error;
      }
    },
    async markAllActivityRead(): Promise<void> {
      update(applyActivityRead);
      try {
        await port.request("teamChat.activity.markAllRead", {});
      } catch (error) {
        void loadActivity();
        throw error;
      }
    },
    async muteConversation(conversationId: string, muted: boolean): Promise<void> {
      const settle = since();
      const result = await port.request("teamChat.conversation.mute", { conversationId, muted });
      settle((state) => {
        const conversation = state.directory?.conversations.find((item) => item.id === conversationId);
        if (!conversation) return state;
        const { muted: _previous, ...rest } = conversation;
        return upsertConversation(state, result.muted ? { ...rest, muted: true } : rest);
      });
    },
    /** Opens one of the reader's own messages in the composer (ADR 0008). */
    startEditing: (conversationId: string, messageId: string) => update((state) => ({ ...state, editing: { conversationId, messageId } })),
    stopEditing: () => update((state) => state.editing ? { ...state, editing: undefined } : state),
    async editMessage(conversationId: string, messageId: string, body: string, mentionUserIds: readonly string[]): Promise<void> {
      const settle = since();
      const message = await port.request("teamChat.message.edit", {
        conversationId, messageId, body, ...(mentionUserIds.length === 0 ? {} : { mentionUserIds: [...mentionUserIds] })
      });
      settle((state) => ({ ...applyMessageUpdate(state, message), editing: undefined }));
    },
    /** Recalls the reader's own message, or removes another's as a channel manager. */
    async recallMessage(conversationId: string, messageId: string): Promise<void> {
      const settle = since();
      const message = await port.request("teamChat.message.recall", { conversationId, messageId });
      settle((state) => applyMessageUpdate(state, message));
    },
    loadOlder,
    loadNewer,
    markRead,
    selectConversation,
    reloadThread: loadLatest,
    async send(
      conversationId: string,
      body: string,
      mentionUserIds: readonly string[] = [],
      attachments: readonly TeamChatAttachment[] = []
    ): Promise<void> {
      const pending: TeamChatPendingMessage = {
        clientKey: port.newClientKey(), conversationId, body, createdAt: Date.now(), status: "sending",
        ...(mentionUserIds.length === 0 ? {} : { mentionUserIds: [...mentionUserIds] }),
        ...(attachments.length === 0 ? {} : { attachments: [...attachments] })
      };
      update((state) => addPending(state, pending));
      await deliver(pending);
    },
    async retrySend(clientKey: string): Promise<void> {
      const pending = store.getState().pending.find((item) => item.clientKey === clientKey);
      if (!pending || pending.status !== "failed") return;
      update((state) => addPending(state, { ...pending, status: "sending" }));
      await deliver(pending);
    },
    discardPending: (clientKey: string) => update((state) => removePending(state, clientKey)),
    async openDirectMessage(userId: string): Promise<void> {
      await selectConversation(await ensureDirectMessage(userId));
    },
    async createChannel(input: { name: string; visibility: TeamChatVisibility; memberUserIds: string[] }): Promise<void> {
      const settle = since();
      const conversation = await port.request("teamChat.channel.create", input);
      settle((state) => upsertConversation(state, conversation));
      await selectConversation(conversation.id);
    },
    ensureDirectMessage,
    async createWorkCard(conversationId: string, input: {
      title: string; goal: string; acceptance: string; summary: string; refs: TeamChatWorkCardRef[]; assigneeUserId?: string;
    }): Promise<void> {
      const settle = since();
      const message = await port.request("teamChat.workCard.create", { conversationId, clientKey: port.newClientKey(), ...input });
      settle((state) => applyMessage(state, message));
    },
    /** Applies a lifecycle action; a stale revision reloads the thread before rethrowing. */
    async actOnWorkCard(card: TeamChatWorkCard, action: TeamChatWorkCardAction): Promise<void> {
      const settle = since();
      try {
        const next = await port.request("teamChat.workCard.act", { cardId: card.id, action, expectedRevision: card.revision });
        settle((state) => applyWorkCard(state, next));
      } catch (error) {
        if (serviceErrorCode(error) === "work_card_revision_conflict") await loadLatest(card.conversationId);
        throw error;
      }
    },
    channelRoster: (conversationId: string): Promise<TeamChatChannelRoster> => port.request("teamChat.channel.members", { conversationId }),
    /** Applies one governance action, then re-reads the directory (renames, archives and departures change it). */
    async manageChannel(conversationId: string, action: TeamChatChannelAction): Promise<void> {
      await port.request("teamChat.channel.manage", { conversationId, action });
      await loadDirectory();
    },
    /** Agent members (ADR 0004): every change re-reads the directory, which carries the Agents. */
    async createAgent(input: { name: string; description: string }): Promise<string> {
      const agent = await port.request("teamChat.agent.create", input);
      await loadDirectory();
      return agent.userId;
    },
    async updateAgent(input: { agentUserId: string; name?: string; description?: string; dailyLimit?: number }): Promise<void> {
      await port.request("teamChat.agent.update", input);
      await loadDirectory();
    },
    async setAgentDisabled(agentUserId: string, disabled: boolean): Promise<void> {
      await port.request("teamChat.agent.setDisabled", { agentUserId, disabled });
      await loadDirectory();
    },
    async removeAgent(agentUserId: string): Promise<void> {
      await port.request("teamChat.agent.remove", { agentUserId });
      await loadDirectory();
    },
    async loadAgentHost(): Promise<void> {
      const settle = since();
      const host = await port.request("teamChat.agent.host.get", {});
      settle((state) => ({ ...state, agentHost: host }));
    },
    async hostAgent(binding: TeamChatAgentBinding): Promise<void> {
      const settle = since();
      const host = await port.request("teamChat.agent.host.bind", { binding });
      settle((state) => ({ ...state, agentHost: host }));
    },
    async stopHostingAgent(agentUserId: string): Promise<void> {
      const settle = since();
      const host = await port.request("teamChat.agent.host.unbind", { agentUserId });
      settle((state) => ({ ...state, agentHost: host }));
    },
    /** Webhook bots (ADR 0005). The secret URL is returned to the caller and never kept in the store. */
    listWebhooks: async (conversationId: string) => (await port.request("teamChat.webhook.list", { conversationId })).webhooks,
    async createWebhook(conversationId: string, name: string) {
      const created = await port.request("teamChat.webhook.create", { conversationId, name });
      await loadDirectory();
      return created;
    },
    rotateWebhook: (conversationId: string, botUserId: string) => port.request("teamChat.webhook.rotate", { conversationId, botUserId }),
    async removeWebhook(conversationId: string, botUserId: string): Promise<void> {
      await port.request("teamChat.webhook.remove", { conversationId, botUserId });
      await loadDirectory();
    },
    async joinChannel(conversationId: string): Promise<void> {
      const settle = since();
      const conversation = await port.request("teamChat.channel.join", { conversationId });
      settle((state) => upsertConversation(state, conversation));
      await loadLatest(conversationId);
    }
  };
}

function serviceErrorCode(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null && "details" in error
    ? (error as { details?: Record<string, unknown> }).details?.serviceError
    : undefined;
  return typeof code === "string" ? code : undefined;
}

/** Specific copy for known New Money rejections; never echoes raw service text. */
export function teamChatErrorMessage(error: unknown): string {
  const code = serviceErrorCode(error);
  return (code === undefined ? undefined : messages.teamChat.errors[code]) ?? messages.teamChat.genericError;
}
