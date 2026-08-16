import type {
  ComposerWorkspaceFileRef,
  ConversationPage,
  MessagePageMetadata,
  SessionMessageView,
  SessionSnapshot
} from "@pi67/domain";
import type { StagedPromptAttachment } from "@pi67/protocol";
import { create } from "zustand";
import {
  matchesCommittedSessionProjection,
  type SessionProjectionAuthorityState
} from "../session/session-projection-authority.js";
import {
  useSessionProjectionStore,
  type FeatureProjectionAuthority
} from "../session/session-projection-store.js";

export const INITIAL_CONVERSATION_INDEX = 1_000_000;

export type ConversationAuthority = FeatureProjectionAuthority;

export interface ConversationRequestTarget extends ConversationAuthority {
  contentRevision: number;
}

interface RecentConversationProjectionOptions {
  preserveOlder: boolean;
  settleStreaming: boolean;
  operationId?: string;
}

export interface PendingUserAttachment extends StagedPromptAttachment {
  previewUrl?: string;
}

export interface PendingUserTurn {
  submissionId: string;
  operationId: string;
  authority: ConversationAuthority;
  message: SessionMessageView;
  attachments: PendingUserAttachment[];
  workspaceFiles?: ComposerWorkspaceFileRef[];
  status: "accepted" | "failed";
  retryableVisionAssistance?: true;
}

export interface ConversationProjectionView {
  messages: SessionMessageView[];
  pendingUserTurn: PendingUserTurn | undefined;
  page: MessagePageMetadata;
  streaming: boolean;
  loadingOlder: boolean;
  firstItemIndex: number;
  error: string | undefined;
}

interface ConversationState {
  authority: ConversationAuthority | undefined;
  contentRevision: number;
  messages: SessionMessageView[];
  pendingUserTurn: PendingUserTurn | undefined;
  page: MessagePageMetadata;
  streaming: boolean;
  loadingOlder: boolean;
  firstItemIndex: number;
  error: string | undefined;
  replaceSnapshot: (
    snapshot: SessionSnapshot,
    authority: ConversationAuthority
  ) => boolean;
  invalidateProjection: () => void;
  reset: () => void;
  capture: (authority: ConversationAuthority) => ConversationRequestTarget | undefined;
  currentTarget: (
    canonicalAuthority: SessionProjectionAuthorityState
  ) => ConversationRequestTarget | undefined;
  startOlder: (target: ConversationRequestTarget, startCursor: string) => boolean;
  prependOlder: (
    target: ConversationRequestTarget,
    startCursor: string,
    page: ConversationPage
  ) => boolean;
  finishOlder: (target: ConversationRequestTarget, error?: string) => void;
  replaceRecent: (
    target: ConversationRequestTarget,
    page: ConversationPage,
    options: RecentConversationProjectionOptions
  ) => boolean;
  installPendingUserTurn: (turn: PendingUserTurn) => boolean;
  markPendingUserTurnFailed: (
    operationId: string,
    error: string,
    retryableVisionAssistance?: boolean
  ) => boolean;
  setStreaming: (streaming: boolean, authority: ConversationAuthority) => boolean;
}

const EMPTY_PAGE: MessagePageMetadata = { hasOlder: false, hasNewer: false };
const EMPTY_CONVERSATION_PROJECTION: ConversationProjectionView = {
  messages: [],
  pendingUserTurn: undefined,
  page: EMPTY_PAGE,
  streaming: false,
  loadingOlder: false,
  firstItemIndex: INITIAL_CONVERSATION_INDEX,
  error: undefined
};

export const useConversationStore = create<ConversationState>((set, get) => ({
  authority: undefined,
  contentRevision: 0,
  messages: [],
  pendingUserTurn: undefined,
  page: EMPTY_PAGE,
  streaming: false,
  loadingOlder: false,
  firstItemIndex: INITIAL_CONVERSATION_INDEX,
  error: undefined,

  replaceSnapshot(snapshot, authority) {
    if (snapshot.sessionId !== authority.sessionId) return false;
    const pendingUserTurn = get().pendingUserTurn;
    set((state) => ({
      authority,
      contentRevision: state.contentRevision + 1,
      messages: snapshot.messages,
      pendingUserTurn: undefined,
      page: snapshot.messagePage,
      streaming: snapshot.streaming,
      loadingOlder: false,
      firstItemIndex: INITIAL_CONVERSATION_INDEX,
      error: undefined
    }));
    revokePendingAttachments(pendingUserTurn);
    return matchesAuthority(get().authority, authority);
  },

  invalidateProjection() {
    const pendingUserTurn = get().pendingUserTurn;
    set((state) => ({
      contentRevision: state.contentRevision + 1,
      pendingUserTurn: undefined,
      streaming: false,
      loadingOlder: false,
      error: undefined
    }));
    revokePendingAttachments(pendingUserTurn);
  },

  reset() {
    const pendingUserTurn = get().pendingUserTurn;
    set((state) => ({
      authority: undefined,
      contentRevision: state.contentRevision + 1,
      messages: [],
      pendingUserTurn: undefined,
      page: EMPTY_PAGE,
      streaming: false,
      loadingOlder: false,
      firstItemIndex: INITIAL_CONVERSATION_INDEX,
      error: undefined
    }));
    revokePendingAttachments(pendingUserTurn);
  },

  capture(authority) {
    const state = get();
    if (!matchesAuthority(state.authority, authority)) return undefined;
    return {
      ...authority,
      contentRevision: state.contentRevision
    };
  },

  currentTarget(canonicalAuthority) {
    const state = get();
    return matchesCommittedSessionProjection(state.authority, canonicalAuthority)
      ? { ...state.authority!, contentRevision: state.contentRevision }
      : undefined;
  },

  startOlder(target, startCursor) {
    const state = get();
    if (
      !matchesTarget(state, target)
      || state.loadingOlder
      || !state.page.hasOlder
      || state.page.startCursor !== startCursor
    ) return false;
    set({ loadingOlder: true, error: undefined });
    return true;
  },

  prependOlder(target, startCursor, page) {
    const state = get();
    if (
      !matchesTarget(state, target)
      || state.page.startCursor !== startCursor
      || page.sessionId !== target.sessionId
    ) return false;
    const existingIds = new Set(state.messages.map((message) => message.id));
    const olderMessages = page.messages.filter((message) => !existingIds.has(message.id));
    set({
      messages: [...olderMessages, ...state.messages],
      page: {
        ...(page.startCursor === undefined ? {} : { startCursor: page.startCursor }),
        ...(state.page.endCursor === undefined
          ? page.endCursor === undefined ? {} : { endCursor: page.endCursor }
          : { endCursor: state.page.endCursor }),
        hasOlder: page.hasOlder,
        hasNewer: state.page.hasNewer
      },
      firstItemIndex: Math.max(0, state.firstItemIndex - olderMessages.length),
      error: undefined
    });
    return true;
  },

  finishOlder(target, error) {
    if (!matchesTarget(get(), target)) return;
    set({ loadingOlder: false, error });
  },

  replaceRecent(target, page, options) {
    const state = get();
    if (!matchesTarget(state, target) || page.sessionId !== target.sessionId) return false;
    const projection = options.preserveOlder
      ? mergeRecentPage(state.messages, state.page, page)
      : { messages: page.messages, page: metadataFromPage(page), resetIndex: true };
    const pendingConfirmed = confirmsPendingUserTurn(
      state.pendingUserTurn,
      state.messages,
      page,
      options.operationId
    );
    set({
      messages: projection.messages,
      ...(pendingConfirmed ? { pendingUserTurn: undefined } : {}),
      page: projection.page,
      streaming: options.settleStreaming ? false : state.streaming,
      loadingOlder: false,
      ...(projection.resetIndex ? { firstItemIndex: INITIAL_CONVERSATION_INDEX } : {}),
      error: undefined
    });
    if (pendingConfirmed) revokePendingAttachments(state.pendingUserTurn);
    return true;
  },

  installPendingUserTurn(turn) {
    const state = get();
    if (!matchesAuthority(state.authority, turn.authority)) return false;
    if (
      state.pendingUserTurn?.submissionId === turn.submissionId
      && state.pendingUserTurn.operationId === turn.operationId
    ) return true;
    const replaced = state.pendingUserTurn;
    set({ pendingUserTurn: turn });
    revokePendingAttachments(replaced, turn.attachments);
    return true;
  },

  markPendingUserTurnFailed(operationId, error, retryableVisionAssistance = false) {
    const pendingUserTurn = get().pendingUserTurn;
    if (!pendingUserTurn || pendingUserTurn.operationId !== operationId) return false;
    set({
      pendingUserTurn: {
        ...pendingUserTurn,
        status: "failed",
        message: { ...pendingUserTurn.message, error: `发送失败：${error}` },
        ...(retryableVisionAssistance ? { retryableVisionAssistance: true as const } : {})
      }
    });
    return true;
  },

  setStreaming(streaming, authority) {
    if (!matchesAuthority(get().authority, authority)) return false;
    set({ streaming });
    return true;
  }
}));

export function selectCommittedConversationProjection(
  state: Pick<ConversationState,
    | "authority"
    | "messages"
    | "pendingUserTurn"
    | "page"
    | "streaming"
    | "loadingOlder"
    | "firstItemIndex"
    | "error"
  >,
  canonicalAuthority: SessionProjectionAuthorityState
): ConversationProjectionView {
  return matchesCommittedSessionProjection(state.authority, canonicalAuthority)
    ? state
    : EMPTY_CONVERSATION_PROJECTION;
}

export function useCommittedConversationProjection(): ConversationProjectionView {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useConversationStore((state) => (
    selectCommittedConversationProjection(state, canonicalAuthority)
  ));
}

export function useCommittedConversationStreaming(): boolean {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useConversationStore((state) => (
    matchesCommittedSessionProjection(state.authority, canonicalAuthority)
      ? state.streaming
      : false
  ));
}

function matchesAuthority(
  current: ConversationAuthority | undefined,
  incoming: ConversationAuthority
): boolean {
  return current !== undefined
    && current.hostEpoch === incoming.hostEpoch
    && current.sessionId === incoming.sessionId
    && current.sessionGeneration === incoming.sessionGeneration
    && current.projectionRevision === incoming.projectionRevision;
}

function matchesTarget(
  state: Pick<ConversationState, "authority" | "contentRevision">,
  target: ConversationRequestTarget
): boolean {
  return state.contentRevision === target.contentRevision
    && matchesAuthority(state.authority, target);
}

function mergeRecentPage(
  messages: SessionMessageView[],
  currentPage: MessagePageMetadata,
  page: ConversationPage
): { messages: SessionMessageView[]; page: MessagePageMetadata; resetIndex?: boolean } {
  if (page.messages.length === 0) {
    return { messages: [], page: metadataFromPage(page), resetIndex: true };
  }
  const recentIds = new Set(page.messages.map((message) => message.id));
  const overlapIndex = messages.findIndex((message) => recentIds.has(message.id));
  if (overlapIndex < 0) {
    return { messages: page.messages, page: metadataFromPage(page), resetIndex: true };
  }
  const retained = messages.slice(0, overlapIndex).filter((message) => !recentIds.has(message.id));
  return {
    messages: [...retained, ...page.messages],
    page: {
      ...(retained.length > 0 && currentPage.startCursor !== undefined
        ? { startCursor: currentPage.startCursor }
        : page.startCursor === undefined ? {} : { startCursor: page.startCursor }),
      ...(page.endCursor === undefined ? {} : { endCursor: page.endCursor }),
      hasOlder: retained.length > 0 ? currentPage.hasOlder : page.hasOlder,
      hasNewer: page.hasNewer
    }
  };
}

function metadataFromPage(page: ConversationPage): MessagePageMetadata {
  return {
    ...(page.startCursor === undefined ? {} : { startCursor: page.startCursor }),
    ...(page.endCursor === undefined ? {} : { endCursor: page.endCursor }),
    hasOlder: page.hasOlder,
    hasNewer: page.hasNewer
  };
}

function confirmsPendingUserTurn(
  pending: PendingUserTurn | undefined,
  currentMessages: SessionMessageView[],
  page: ConversationPage,
  operationId: string | undefined
): boolean {
  if (!pending || pending.operationId !== operationId) return false;
  const currentIds = new Set(currentMessages.map((message) => message.id));
  return page.messages.some((message) => message.role === "user" && !currentIds.has(message.id));
}

function revokePendingAttachments(
  pending: PendingUserTurn | undefined,
  retained: readonly PendingUserAttachment[] = []
): void {
  if (!pending) return;
  const retainedUrls = new Set(retained.flatMap((attachment) => (
    attachment.previewUrl ? [attachment.previewUrl] : []
  )));
  for (const attachment of pending.attachments) {
    if (attachment.previewUrl && !retainedUrls.has(attachment.previewUrl)) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}
