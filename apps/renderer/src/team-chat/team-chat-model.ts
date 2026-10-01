import {
  mergeTeamChatMessages,
  teamChatCodePointPrefix,
  teamChatDirectPeer,
  type TeamChatConnectionState,
  type TeamChatConversation,
  type TeamChatDirectory,
  type TeamChatMember,
  type TeamChatMessage,
  type TeamChatPushEvent,
  type TeamChatWorkCard
} from "@pi67/domain";

export interface TeamChatThread {
  messages: TeamChatMessage[];
  /** Older history exists before the first loaded message. */
  hasMore: boolean;
  status: "loading" | "ready" | "error";
  loadingOlder: boolean;
}

export interface TeamChatPendingMessage {
  clientKey: string;
  conversationId: string;
  body: string;
  createdAt: number;
  status: "sending" | "failed";
  error?: string;
}

/** Disposable presentation cache; New Money remains the chat truth. */
export interface TeamChatState {
  connection: TeamChatConnectionState | undefined;
  directory: TeamChatDirectory | undefined;
  directoryStatus: "idle" | "loading" | "ready" | "error";
  selectedConversationId: string | undefined;
  threads: Readonly<Record<string, TeamChatThread>>;
  pending: readonly TeamChatPendingMessage[];
}

export const INITIAL_TEAM_CHAT_STATE: TeamChatState = {
  connection: undefined,
  directory: undefined,
  directoryStatus: "idle",
  selectedConversationId: undefined,
  threads: {},
  pending: []
};

const PREVIEW_CHARS = 140;

export function upsertConversation(state: TeamChatState, conversation: TeamChatConversation): TeamChatState {
  if (!state.directory) return state;
  const others = state.directory.conversations.filter((item) => item.id !== conversation.id);
  return { ...state, directory: { ...state.directory, conversations: sortConversations([conversation, ...others]) } };
}

export function replaceDirectory(state: TeamChatState, directory: TeamChatDirectory): TeamChatState {
  const known = new Set(directory.conversations.map((conversation) => conversation.id));
  const threads = Object.fromEntries(Object.entries(state.threads).filter(([id]) => known.has(id)));
  return {
    ...state,
    directory: { ...directory, conversations: sortConversations(directory.conversations) },
    directoryStatus: "ready",
    threads,
    selectedConversationId: state.selectedConversationId !== undefined && known.has(state.selectedConversationId)
      ? state.selectedConversationId
      : undefined
  };
}

export function applyMessagePage(
  state: TeamChatState,
  conversationId: string,
  page: { messages: readonly TeamChatMessage[]; hasMore?: boolean },
  position: "latest" | "older" | "newer"
): TeamChatState {
  const current = state.threads[conversationId];
  const messages = mergeTeamChatMessages(position === "latest" ? [] : current?.messages ?? [], page.messages);
  const hasMore = position === "newer" ? current?.hasMore ?? false : page.hasMore ?? false;
  const settled = state.pending.filter((item) => !page.messages.some((message) => message.clientKey === item.clientKey
    && message.conversationId === item.conversationId));
  return {
    ...state,
    pending: settled.length === state.pending.length ? state.pending : settled,
    threads: { ...state.threads, [conversationId]: { messages, hasMore, status: "ready", loadingOlder: false } }
  };
}

export function setThreadStatus(
  state: TeamChatState,
  conversationId: string,
  patch: Partial<Pick<TeamChatThread, "status" | "loadingOlder">>
): TeamChatState {
  const current = state.threads[conversationId] ?? { messages: [], hasMore: false, status: "loading", loadingOlder: false };
  return { ...state, threads: { ...state.threads, [conversationId]: { ...current, ...patch } } };
}

/** Applies one message the service accepted, whether pushed or returned from send. */
export function applyMessage(state: TeamChatState, message: TeamChatMessage): TeamChatState {
  const selfUserId = state.directory?.selfUserId;
  const fromSelf = message.senderUserId === selfUserId;
  const thread = state.threads[message.conversationId];
  const pending = state.pending.filter((item) => item.clientKey !== message.clientKey);
  let next: TeamChatState = {
    ...state,
    pending: pending.length === state.pending.length ? state.pending : pending,
    threads: thread && thread.status === "ready"
      ? { ...state.threads, [message.conversationId]: { ...thread, messages: mergeTeamChatMessages(thread.messages, [message]) } }
      : state.threads
  };
  const conversation = state.directory?.conversations.find((item) => item.id === message.conversationId);
  if (!conversation) return next;
  const advances = message.seq > conversation.lastSeq;
  next = upsertConversation(next, {
    ...conversation,
    lastSeq: Math.max(conversation.lastSeq, message.seq),
    lastReadSeq: fromSelf ? Math.max(conversation.lastReadSeq, message.seq) : conversation.lastReadSeq,
    unreadCount: fromSelf ? 0 : advances ? Math.min(100, conversation.unreadCount + 1) : conversation.unreadCount,
    ...(advances ? {
      lastMessageAt: message.createdAt,
      lastSenderUserId: message.senderUserId,
      lastPreview: teamChatCodePointPrefix(message.body, PREVIEW_CHARS)
    } : {})
  });
  return next;
}

export function applyReadCursor(state: TeamChatState, conversationId: string, lastReadSeq: number): TeamChatState {
  const conversation = state.directory?.conversations.find((item) => item.id === conversationId);
  if (!conversation || lastReadSeq <= conversation.lastReadSeq) return state;
  return upsertConversation(state, {
    ...conversation,
    lastReadSeq,
    unreadCount: lastReadSeq >= conversation.lastSeq ? 0 : conversation.unreadCount
  });
}

/** Replaces a carried Work Card when the update is not older than what is shown. */
export function applyWorkCard(state: TeamChatState, card: TeamChatWorkCard): TeamChatState {
  const thread = state.threads[card.conversationId];
  if (!thread) return state;
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (message.workCard?.id !== card.id || message.workCard.revision > card.revision) return message;
    changed = true;
    return { ...message, workCard: card };
  });
  return changed ? { ...state, threads: { ...state.threads, [card.conversationId]: { ...thread, messages } } } : state;
}

/** Reduces a push. Returns whether the directory must be re-read (unknown or changed conversation). */
export function applyPush(state: TeamChatState, event: TeamChatPushEvent): { state: TeamChatState; refreshDirectory: boolean } {
  switch (event.type) {
    case "message.created": {
      const known = state.directory?.conversations.some((item) => item.id === event.message.conversationId) ?? false;
      return { state: applyMessage(state, event.message), refreshDirectory: !known };
    }
    case "read.changed":
      return { state: applyReadCursor(state, event.conversationId, event.lastReadSeq), refreshDirectory: false };
    case "conversation.changed":
      return { state, refreshDirectory: true };
    case "work_card.changed":
      return { state: applyWorkCard(state, event.card), refreshDirectory: false };
  }
}

export function addPending(state: TeamChatState, pending: TeamChatPendingMessage): TeamChatState {
  return { ...state, pending: [...state.pending.filter((item) => item.clientKey !== pending.clientKey), pending] };
}

export function failPending(state: TeamChatState, clientKey: string, error: string): TeamChatState {
  return {
    ...state,
    pending: state.pending.map((item) => item.clientKey === clientKey ? { ...item, status: "failed", error } : item)
  };
}

export function removePending(state: TeamChatState, clientKey: string): TeamChatState {
  return { ...state, pending: state.pending.filter((item) => item.clientKey !== clientKey) };
}

function sortConversations(conversations: readonly TeamChatConversation[]): TeamChatConversation[] {
  return [...conversations].sort((left, right) => (
    (right.lastMessageAt ?? right.createdAt) - (left.lastMessageAt ?? left.createdAt) || left.id.localeCompare(right.id)
  ));
}

export function memberById(directory: TeamChatDirectory | undefined, userId: string | undefined): TeamChatMember | undefined {
  if (!directory || userId === undefined) return undefined;
  return directory.members.find((member) => member.userId === userId);
}

/** Channel name, or the peer's display name for a direct message. */
export function conversationTitle(
  directory: TeamChatDirectory | undefined,
  conversation: TeamChatConversation,
  unknownTeammate: string
): string {
  if (conversation.kind === "channel") return conversation.name ?? "";
  const peer = teamChatDirectPeer(conversation, directory?.selfUserId ?? "");
  return memberById(directory, peer)?.displayName ?? unknownTeammate;
}

/** The direct message with a teammate, when one exists. */
export function directMessageWith(directory: TeamChatDirectory | undefined, userId: string): TeamChatConversation | undefined {
  return directory?.conversations.find((conversation) => (
    conversation.kind === "dm" && teamChatDirectPeer(conversation, directory.selfUserId) === userId
  ));
}

export function canSendTo(directory: TeamChatDirectory | undefined, conversation: TeamChatConversation): boolean {
  if (!conversation.joined) return false;
  if (conversation.kind === "channel") return true;
  return conversation.memberCount === 2 && memberById(directory, teamChatDirectPeer(conversation, directory?.selfUserId ?? "")) !== undefined;
}
