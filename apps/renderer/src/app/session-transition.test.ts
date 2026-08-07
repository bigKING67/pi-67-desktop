import type { SessionResourceCatalogResult, SessionSnapshot } from "@pi67/domain";
import {
  eventEnvelope,
  type ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { currentRendererSessionAuthority } from "../session/session-authority.js";
import { useAppStore } from "./app-store.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition,
  runSessionResourceCatalogTransition
} from "./session-transition.js";

describe("renderer session transition authority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
    setActiveSession("session-old", 3);
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      sessionId: "session-new",
      items: [],
      truncated: false,
      total: 0
    } as never);
  });

  it("does not let an old response overwrite a newer Host transaction", async () => {
    const deferred = deferredBootstrapAcknowledgement();
    const onError = vi.fn();
    const transition = runSessionBootstrapTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Opening",
        request: () => deferred.promise,
        onError
      }
    );
    await Promise.resolve();

    prepareRendererSessionTransaction("host-replaced");
    useAppStore.setState({
      hostEpoch: 10,
      sessionTransitionPending: true
    });
    deferred.resolve(bootstrapAcknowledgement("session-old-response", 4));
    await transition;

    expect(useAppStore.getState()).toMatchObject({
      hostEpoch: 10,
      sessionTransitionPending: true
    });
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps an authoritative bootstrap when it arrives before the command response", async () => {
    const deferred = deferredBootstrapAcknowledgement();
    const transition = runSessionBootstrapTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Opening",
        request: () => deferred.promise,
        onError: vi.fn()
      }
    );
    await Promise.resolve();

    const bootstrap = snapshot("session-new");
    const event = {
      type: "session.bootstrap",
      payload: { snapshot: bootstrap, reason: "session-open" }
    } as const;
    useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-new",
      sessionGeneration: 4
    })));
    deferred.resolve(bootstrapAcknowledgement("session-new", 4));
    await transition;

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Pi 会话已恢复", recoverable: true }
    });
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-new",
      sessionGeneration: 4
    });
    expect(useConversationStore.getState().authority).toMatchObject({
      sessionId: "session-new",
      sessionGeneration: 4
    });
  });

  it("fails closed when the acknowledgement arrives without a bootstrap event", async () => {
    const onError = vi.fn();

    await runSessionBootstrapTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Opening",
        request: async () => bootstrapAcknowledgement("session-new", 4),
        onError
      }
    );

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Pi 运行服务未发送 authoritative session.bootstrap 事件。"
    }));
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
  });

  it("does not report a narrow control response as installed when all owned groups are stale", async () => {
    const deferred = deferredResourceCatalogResult();
    const onError = vi.fn();
    const transition = runSessionResourceCatalogTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Reloading",
        readyDetail: "Ready",
        request: () => deferred.promise,
        onError
      }
    );
    await Promise.resolve();

    const authority = currentRendererSessionAuthority(useAppStore.getState())!;
    const target = useSessionProjectionStore.getState().capture(authority)!;
    useSessionProjectionStore.getState().applyMeta(authority, {
      sessionName: "Newer",
      selectedModel: undefined,
      thinkingLevel: "high"
    });
    useSessionProjectionStore.getState().applyModelCatalogResult(target, {
      sessionId: "session-old",
      controls: { thinkingLevel: "off" },
      modelCatalog: { models: [], providers: [], availableThinkingLevels: ["off"] }
    });
    useSessionProjectionStore.getState().applySnapshot(
      target,
      { ...snapshot("session-old"), resources: [{ kind: "skill", id: "newer", label: "Newer", status: "ready" }] },
      ["resources"]
    );

    deferred.resolve(resourceCatalogResult());
    await transition;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Resource catalog response belongs to a stale or mismatched projection."
    }));
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      controls: { thinkingLevel: "high" },
      resources: [{ id: "newer" }]
    });
  });

  it("does not publish ready after a projection subscriber starts a newer recovery transaction", async () => {
    const deferred = deferredResourceCatalogResult();
    const onError = vi.fn();
    const transition = runSessionResourceCatalogTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Reloading",
        readyDetail: "Stale ready",
        request: () => deferred.promise,
        onError
      }
    );
    await Promise.resolve();

    let superseded = false;
    const unsubscribe = useSessionProjectionStore.subscribe((state, previous) => {
      if (superseded || state.resources === previous.resources) return;
      superseded = true;
      prepareRendererSessionTransaction("host-replaced");
      useAppStore.setState({
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "Newer recovery", recoverable: true }
      });
    });

    deferred.resolve(resourceCatalogResult({
      resources: [{ kind: "skill", id: "response", label: "Response", status: "ready" }]
    }));
    await transition;
    unsubscribe();

    expect(superseded).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "Newer recovery" }
    });
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
  });

  it("keeps newer incremental projections when rollback acknowledgement arrives", async () => {
    const deferred = deferredRollbackAcknowledgement();
    const onError = vi.fn();
    const transition = runIncrementalSessionTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Rolling back",
        readyDetail: "Rolled back",
        request: () => deferred.promise,
        onError
      }
    );
    await Promise.resolve();

    const authority = currentRendererSessionAuthority(useAppStore.getState())!;
    useSessionProjectionStore.getState().applyUsage(authority, {
      tokens: 42,
      cost: 0.5,
      contextPercent: 7
    });
    deferred.resolve(rollbackAcknowledgement());
    await transition;

    expect(onError).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Rolled back" }
    });
    expect(useSessionProjectionStore.getState().usage).toEqual({
      tokens: 42,
      cost: 0.5,
      contextPercent: 7
    });
  });

  it("fails closed when rollback acknowledgement belongs to another generation", async () => {
    const onError = vi.fn();
    await runIncrementalSessionTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Rolling back",
        readyDetail: "Rolled back",
        request: async () => ({
          ...rollbackAcknowledgement(),
          sessionGeneration: 4
        }),
        onError
      }
    );

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Session mutation acknowledgement belongs to a stale or mismatched projection."
    }));
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
  });
});

function setActiveSession(sessionId: string, sessionGeneration: number): void {
  useAppStore.setState({
    connected: true,
    hostEpoch: 9,
    workspace: "/workspace",
    runtime: { phase: "ready", detail: "Ready", recoverable: true }
  });
  installSessionProjectionFixture(
    useAppStore.getState(),
    snapshot(sessionId),
    sessionGeneration
  );
}

function deferredBootstrapAcknowledgement() {
  let resolve!: (value: ProjectionMutationAcknowledgement) => void;
  return {
    promise: new Promise<ProjectionMutationAcknowledgement>((done) => {
      resolve = done;
    }),
    resolve
  };
}

function deferredResourceCatalogResult() {
  let resolve!: (value: SessionResourceCatalogResult) => void;
  return {
    promise: new Promise<SessionResourceCatalogResult>((done) => {
      resolve = done;
    }),
    resolve
  };
}

function deferredRollbackAcknowledgement() {
  let resolve!: (value: ReturnType<typeof rollbackAcknowledgement>) => void;
  return {
    promise: new Promise<ReturnType<typeof rollbackAcknowledgement>>((done) => {
      resolve = done;
    }),
    resolve
  };
}

function rollbackAcknowledgement() {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId: "session-old",
    sessionFileIdentity: "session-file-session-old",
    sessionGeneration: 3,
    eventSequence: 8
  };
}

function bootstrapAcknowledgement(
  sessionId: string,
  sessionGeneration: number
): ProjectionMutationAcknowledgement {
  return {
    accepted: true,
    hostEpoch: 9,
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionGeneration,
    eventSequence: 1
  };
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function resourceCatalogResult(
  overrides: Partial<SessionResourceCatalogResult> = {}
): SessionResourceCatalogResult {
  return {
    sessionId: "session-old",
    controls: { thinkingLevel: "off" },
    modelCatalog: { models: [], providers: [], availableThinkingLevels: ["off"] },
    resources: [],
    ...overrides
  };
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
}
