import type { AgentEvent } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  type ConversationAuthority,
  useConversationStore
} from "./conversation-store.js";

let olderPageRevision = 0;
let recentPageRevision = 0;

export async function loadOlderConversation(): Promise<void> {
  const state = useConversationStore.getState();
  const target = state.currentTarget(useSessionProjectionStore.getState().authority);
  const startCursor = state.page.startCursor;
  if (!target || !state.page.hasOlder || !startCursor) return;
  const revision = ++olderPageRevision;
  if (!state.startOlder(target, startCursor)) return;
  try {
    const page = await agentConnectionController.request("message.page", {
      direction: "older",
      cursor: startCursor,
      limit: 100
    });
    if (revision !== olderPageRevision) return;
    useConversationStore.getState().prependOlder(target, startCursor, page);
  } catch (error) {
    if (revision === olderPageRevision) {
      useConversationStore.getState().finishOlder(target, `无法加载更早消息：${errorMessage(error)}`);
    }
    return;
  }
  if (revision === olderPageRevision) useConversationStore.getState().finishOlder(target);
}

export function refreshConversation(
  event: Extract<AgentEvent, { type: "conversation.changed" }>,
  authority: ConversationAuthority,
  operationId?: string
): void {
  if (event.payload.sessionId !== authority.sessionId) return;
  const target = useConversationStore.getState().capture(authority);
  if (!target) return;
  const revision = ++recentPageRevision;
  olderPageRevision += 1;
  useConversationStore.getState().finishOlder(target);
  void agentConnectionController.request("message.page", { direction: "older", limit: 100 }).then((page) => {
    if (revision !== recentPageRevision) return;
    const applied = useConversationStore.getState().replaceRecent(
      target,
      page,
      {
        preserveOlder: event.payload.reason === "settled" || event.payload.reason === "user-appended",
        settleStreaming: event.payload.reason !== "user-appended",
        ...(operationId === undefined ? {} : { operationId })
      }
    );
    if (applied && event.payload.reason !== "user-appended") {
      useLiveTurnStore.getState().settle(operationId);
    }
  }).catch((error: unknown) => {
    if (revision === recentPageRevision) {
      useConversationStore.getState().finishOlder(target, `无法刷新对话消息：${errorMessage(error)}`);
    }
  });
}

export function setConversationStreaming(authority: ConversationAuthority, streaming: boolean): void {
  useConversationStore.getState().setStreaming(streaming, authority);
}

export function resetConversationRequests(): void {
  olderPageRevision += 1;
  recentPageRevision += 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
