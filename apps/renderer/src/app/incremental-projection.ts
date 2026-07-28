import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { refreshWorkspaceChanges } from "../changes/workspace-changes-controller.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { refreshSessionTree } from "../session-tree/session-tree-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  refreshConversation,
  setConversationStreaming
} from "../conversation/conversation-controller.js";
import type { AppState } from "./app-store.types.js";
import {
  acceptRendererSessionEvent,
  type RendererSessionAuthority
} from "../session/session-authority.js";
import { activateRendererSessionChanges } from "../changes/workspace-changes-controller.js";
import { replaceRendererSessionSnapshot } from "./renderer-session-installation.js";
import { cancelSessionImportBootstrapWatchdog } from "./session-import-bootstrap-watchdog.js";
import { eventSessionAuthority } from "../connection/event-authority.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

type ProjectionAgentEventType =
  | "runtime.ready"
  | "session.bootstrap"
  | "workspace.changeChanged"
  | "conversation.changed"
  | "queue.changed"
  | "session.metaChanged"
  | "model.catalog.changed"
  | "tree.changed"
  | "usage.changed";

export type ProjectionAgentEvent = Extract<AgentEvent, { type: ProjectionAgentEventType }>;

export function handleProjectionEvent(
  event: AgentEvent,
  envelope: EventEnvelope,
  get: StoreGet,
  set: StoreSet
): event is ProjectionAgentEvent {
  switch (event.type) {
    case "runtime.ready":
      if (!installAuthoritativeSnapshot(
        event.payload.snapshot,
        envelope,
        get,
        set,
        get().runtime.phase === "recovering" ? "Pi 会话已恢复" : "Pi SDK 已就绪"
      )) return true;
      activateRendererSessionChanges(get());
      void refreshWorkspaceChanges();
      return true;
    case "session.bootstrap":
      if (
        event.payload.reason === "session-import"
        && !acceptSessionImportBootstrap(get(), envelope)
      ) return true;
      if (!installAuthoritativeSnapshot(
        event.payload.snapshot,
        envelope,
        get,
        set,
        bootstrapReadyDetail(event.payload.reason)
      )) return true;
      const bootstrapAuthority = eventSessionAuthority(envelope);
      if (event.payload.reason === "session-import" && bootstrapAuthority?.operationId !== undefined) {
        cancelSessionImportBootstrapWatchdog({
          hostEpoch: envelope.hostEpoch,
          operationId: bootstrapAuthority.operationId
        });
      }
      activateRendererSessionChanges(get());
      void refreshWorkspaceChanges();
      if (event.payload.reason === "session-import") {
        void queryFirstSessionCatalog({ refresh: true });
      }
      return true;
    case "workspace.changeChanged": {
      const target = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!target) return true;
      useWorkspaceChangesStore.getState().applyChange(target, event.payload.change);
      return true;
    }
    case "conversation.changed": {
      const authority = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!authority) return true;
      refreshConversation(event, authority, eventSessionAuthority(envelope)?.operationId);
      return true;
    }
    case "queue.changed":
      applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyQueue(authority, {
          steeringQueue: event.payload.steeringQueue,
          followUpQueue: event.payload.followUpQueue
        });
      });
      return true;
    case "session.metaChanged": {
      const authority = acceptScopedEvent(envelope, get);
      if (!authority) return true;
      setConversationStreaming(authority, event.payload.streaming);
      useSessionProjectionStore.getState().applyMeta(authority, {
        thinkingLevel: event.payload.thinkingLevel,
        sessionName: event.payload.sessionName,
        selectedModel: event.payload.selectedModel
      });
      return true;
    }
    case "model.catalog.changed": {
      const authority = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!authority) return true;
      const store = useSessionProjectionStore.getState();
      const target = store.capture(authority);
      if (target) store.applyModelCatalogResult(target, event.payload);
      return true;
    }
    case "tree.changed": {
      const authority = acceptScopedEvent(envelope, get);
      if (authority) void refreshSessionTree(authority);
      return true;
    }
    case "usage.changed":
      applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyUsage(authority, {
          tokens: event.payload.tokens,
          cost: event.payload.cost,
          ...(event.payload.contextPercent === undefined ? {} : { contextPercent: event.payload.contextPercent })
        });
      });
      return true;
    default:
      return false;
  }
}

function applyScopedSessionProjection(
  envelope: EventEnvelope,
  get: StoreGet,
  apply: (authority: RendererSessionAuthority) => void
): void {
  const authority = acceptScopedEvent(envelope, get);
  if (authority) apply(authority);
}

function acceptScopedEvent(
  envelope: EventEnvelope,
  get: StoreGet,
  payloadSessionId?: string
): RendererSessionAuthority | undefined {
  return acceptRendererSessionEvent(get(), envelope, payloadSessionId);
}

function bootstrapReadyDetail(
  reason: Extract<AgentEvent, { type: "session.bootstrap" }>["payload"]["reason"]
): string {
  switch (reason) {
    case "session-create":
      return "Pi 新会话已就绪";
    case "session-open":
      return "Pi 会话已恢复";
    case "session-fork":
      return "Pi 分支会话已就绪";
    case "session-import":
      return "Pi 导入会话已就绪";
  }
}

function installAuthoritativeSnapshot(
  snapshot: Parameters<typeof replaceRendererSessionSnapshot>[1],
  envelope: EventEnvelope,
  get: StoreGet,
  set: StoreSet,
  readyDetail?: string
): boolean {
  const current = get();
  const eventAuthority = eventSessionAuthority(envelope);
  if (
    !current.connected
    || eventAuthority === undefined
    || eventAuthority.sessionId !== snapshot.sessionId
    || envelope.hostEpoch !== current.hostEpoch
  ) return false;
  if (!replaceRendererSessionSnapshot(current, snapshot, {
    sessionGeneration: eventAuthority.sessionGeneration,
    ...(eventAuthority.operationId === undefined ? {} : { operationId: eventAuthority.operationId })
  })) return false;
  set((state) => state.connected && state.hostEpoch === envelope.hostEpoch ? {
      sessionTransitionPending: false,
      trustUpdating: false,
      ...reboundSessionImportOperation(state.operation, envelope),
      ...(readyDetail === undefined
        ? {}
        : { runtime: { phase: "ready" as const, detail: readyDetail, recoverable: true } })
    } : {});
  return true;
}

function reboundSessionImportOperation(
  operation: AppState["operation"],
  envelope: EventEnvelope
): Pick<AppState, "operation"> | Record<string, never> {
  const eventAuthority = eventSessionAuthority(envelope);
  if (
    operation?.kind !== "session-import"
    || eventAuthority === undefined
    || operation.operationId !== eventAuthority.operationId
  ) return {};
  return {
    operation: {
      ...operation,
      sessionId: eventAuthority.sessionId,
      sessionGeneration: eventAuthority.sessionGeneration
    }
  };
}

function acceptSessionImportBootstrap(
  state: AppState,
  envelope: EventEnvelope
): boolean {
  const operation = state.operation;
  const eventAuthority = eventSessionAuthority(envelope);
  return state.connected
    && state.hostEpoch === envelope.hostEpoch
    && eventAuthority !== undefined
    && operation?.kind === "session-import"
    && operation.operationId === eventAuthority.operationId
    && (
      operation.lifecycle === "accepted"
      || operation.lifecycle === "running"
      || operation.lifecycle === "waiting-input"
    );
}
