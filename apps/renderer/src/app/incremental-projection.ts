import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
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
  | "session.interactionModeChanged"
  | "plan.proposed"
  | "plan.lifecycleChanged"
  | "model.catalog.changed"
  | "tree.changed"
  | "usage.changed";

export type ProjectionAgentEvent = Extract<AgentEvent, { type: ProjectionAgentEventType }>;
export type ProjectionEventDisposition = "unhandled" | "applied" | "ignored";

export function handleProjectionEvent(
  event: AgentEvent,
  envelope: EventEnvelope,
  get: StoreGet,
  set: StoreSet
): ProjectionEventDisposition {
  switch (event.type) {
    case "runtime.ready":
      // A lazily created target Task emits runtime.ready for its empty initial
      // Session before the requested create/open/fork bootstrap. Keep that
      // implementation detail from briefly replacing the intended projection.
      if (get().sessionBootstrapTransitionPending) return "ignored";
      if (!installAuthoritativeSnapshot(
        event.payload.snapshot,
        envelope,
        get,
        set,
        get().runtime.phase === "recovering" ? "Pi 会话已恢复" : "Pi SDK 已就绪"
      )) return "ignored";
      activateRendererSessionChanges(get());
      return "applied";
    case "session.bootstrap":
      if (
        event.payload.reason === "session-import"
        && !acceptSessionImportBootstrap(get(), envelope)
      ) return "ignored";
      if (!installAuthoritativeSnapshot(
        event.payload.snapshot,
        envelope,
        get,
        set,
        bootstrapReadyDetail(event.payload.reason)
      )) return "ignored";
      const bootstrapAuthority = eventSessionAuthority(envelope);
      if (event.payload.reason === "session-import" && bootstrapAuthority?.operationId !== undefined) {
        cancelSessionImportBootstrapWatchdog({
          hostEpoch: envelope.hostEpoch,
          operationId: bootstrapAuthority.operationId
        });
      }
      activateRendererSessionChanges(get());
      if (event.payload.reason === "session-import" && bootstrapAuthority) {
        void queryFirstSessionCatalog(bootstrapAuthority.workspaceId, { refresh: true });
      }
      return "applied";
    case "workspace.changeChanged": {
      const target = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!target) return "ignored";
      useWorkspaceChangesStore.getState().applyChange(target, event.payload.change);
      return "applied";
    }
    case "conversation.changed": {
      const authority = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!authority) return "ignored";
      refreshConversation(event, authority, eventSessionAuthority(envelope)?.operationId);
      return "applied";
    }
    case "queue.changed":
      return applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyQueue(authority, {
          steeringQueue: event.payload.steeringQueue,
          followUpQueue: event.payload.followUpQueue
        });
      });
    case "session.metaChanged": {
      const authority = acceptScopedEvent(envelope, get);
      if (!authority) return "ignored";
      setConversationStreaming(authority, event.payload.streaming);
      useSessionProjectionStore.getState().applyMeta(authority, {
        thinkingLevel: event.payload.thinkingLevel,
        sessionName: event.payload.sessionName,
        selectedModel: event.payload.selectedModel
      });
      return "applied";
    }
    case "session.interactionModeChanged":
      return applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyInteractionMode(
          authority,
          event.payload.interactionMode
        );
      });
    case "plan.proposed":
      return applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyProposedPlan(authority, event.payload.plan);
      });
    case "plan.lifecycleChanged": {
      const authority = acceptScopedEvent(envelope, get);
      if (!authority || !matchesPlanLifecycleAuthority(event, envelope, authority)) return "ignored";
      return useSessionProjectionStore.getState().applyPlanLifecycle(authority, event.payload)
        ? "applied"
        : "ignored";
    }
    case "model.catalog.changed": {
      const authority = acceptScopedEvent(envelope, get, event.payload.sessionId);
      if (!authority) return "ignored";
      const store = useSessionProjectionStore.getState();
      const target = store.capture(authority);
      return target && store.applyModelCatalogResult(target, event.payload)
        ? "applied"
        : "ignored";
    }
    case "tree.changed": {
      const authority = acceptScopedEvent(envelope, get);
      if (!authority) return "ignored";
      void refreshSessionTree(authority);
      return "applied";
    }
    case "usage.changed":
      return applyScopedSessionProjection(envelope, get, (authority) => {
        useSessionProjectionStore.getState().applyUsage(authority, {
          tokens: event.payload.tokens,
          cost: event.payload.cost,
          ...(event.payload.contextPercent === undefined ? {} : { contextPercent: event.payload.contextPercent })
        });
      });
    default:
      return "unhandled";
  }
}

export function isProjectionAgentEvent(event: AgentEvent): event is ProjectionAgentEvent {
  switch (event.type) {
    case "runtime.ready":
    case "session.bootstrap":
    case "workspace.changeChanged":
    case "conversation.changed":
    case "queue.changed":
    case "session.metaChanged":
    case "session.interactionModeChanged":
    case "plan.proposed":
    case "plan.lifecycleChanged":
    case "model.catalog.changed":
    case "tree.changed":
    case "usage.changed":
      return true;
    default:
      return false;
  }
}

function matchesPlanLifecycleAuthority(
  event: Extract<AgentEvent, { type: "plan.lifecycleChanged" }>,
  envelope: EventEnvelope,
  authority: RendererSessionAuthority
): boolean {
  const change = event.payload;
  if (change.phase === "dismissed") return true;
  return change.hostEpoch === authority.hostEpoch
    && change.sessionId === authority.sessionId
    && change.sessionFileIdentity === authority.sessionFileIdentity
    && change.sessionGeneration === authority.sessionGeneration
    && eventSessionAuthority(envelope)?.operationId === change.operationId;
}

function applyScopedSessionProjection(
  envelope: EventEnvelope,
  get: StoreGet,
  apply: (authority: RendererSessionAuthority) => void
): ProjectionEventDisposition {
  const authority = acceptScopedEvent(envelope, get);
  if (!authority) return "ignored";
  apply(authority);
  return "applied";
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
      return "Pi 会话已准备好";
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
      sessionBootstrapTransitionPending: false,
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
      sessionFileIdentity: eventAuthority.sessionFileIdentity,
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
