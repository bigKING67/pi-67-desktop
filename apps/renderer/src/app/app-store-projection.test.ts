import type { SessionSnapshot, WorkspaceChangesProjection, WorkspaceChangeView } from "@pi67/domain";
import { eventEnvelope, type ProjectionResyncResult } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useApprovalStore } from "../approval/approval-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { submitRendererPrompt } from "../composer/prompt-submission-controller.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { selectCommittedExtensionCatalog, useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useAppStore } from "./app-store.js";

const runningChange: WorkspaceChangeView = {
  kind: "edit",
  toolCallId: "tool-change-1",
  path: "src/file.ts",
  pathTruncated: false,
  status: "running",
  patchTruncated: false
};

describe("renderer projection state", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionCatalogStore.getState().reset();
    useConversationStore.getState().reset();
    useLiveTurnStore.getState().reset();
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    setSessionState("session-1", 3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionCatalogStore.getState().reset();
    useConversationStore.getState().reset();
    useLiveTurnStore.getState().reset();
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  });

  it("clears recorded changes when a bootstrap switches the session identity", () => {
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise(() => undefined) as never);
    emitChange(runningChange);
    const nextSnapshot = snapshot("session-2");
    const event = { type: "session.bootstrap", payload: { snapshot: nextSnapshot, reason: "session-open" } } as const;
    useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, {
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 4
    }));

    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(useWorkspaceChangesStore.getState().projection).toBeUndefined();
    expect(useWorkspaceChangesStore.getState().status).toBe("loading");
    expect("messages" in useSessionProjectionStore.getState()).toBe(false);
    expect(useConversationStore.getState().authority?.sessionId).toBe("session-2");
  });

  it("uses the authoritative resync changes instead of retaining the pre-gap projection", async () => {
    emitChange(runningChange);
    const resyncedChanges: WorkspaceChangesProjection = {
      sessionId: "session-1",
      items: [{ ...runningChange, toolCallId: "tool-resynced", path: "src/resynced.ts", status: "completed" }],
      truncated: false,
      total: 1
    };
    mockProjectionResync({
      snapshot: snapshot("session-1"),
      changes: resyncedChanges,
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: {
        revision: 2,
        itemCount: 1,
        source: "sqlite",
        state: "ready",
        rebuilding: false,
        incomplete: false,
        skippedCount: 0
      },
      eventSequence: 10,
      hostEpoch: 9,
      sessionGeneration: 3
    });
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      revision: 2,
      itemCount: 1,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0,
      items: [{
        id: "catalog-session-1",
        path: "/sessions/session-1.jsonl",
        cwd: "/workspace",
        name: "Catalog Session",
        modifiedAt: 10,
        messageCount: 2
      }],
      total: 1,
      hasMore: false
    } as never);

    useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });
    await vi.waitFor(() => expect(useWorkspaceChangesStore.getState().projection).toEqual(resyncedChanges));
    await vi.waitFor(() => expect(useSessionCatalogStore.getState().items).toHaveLength(1));
    expect(request).toHaveBeenCalledWith("session.catalog.query", { scope: "workspace", limit: 50 });
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
    expect(selectCommittedExtensionCatalog(
      useExtensionUiStore.getState().catalog,
      useSessionProjectionStore.getState().authority
    )).toEqual({ items: [], total: 0, truncated: false });
  });

  it("resynchronizes the projection instead of reinitializing a reattached same-epoch Host", async () => {
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      connectionIdentity: undefined,
      hostEpoch: 9,
      runtime: { phase: "recovering", detail: "等待恢复", recoverable: true }
    });
    const activeOperation = {
      operationId: "operation-1",
      kind: "prompt" as const,
      lifecycle: "running" as const,
      cancellable: true,
      sessionId: "session-1",
      sessionGeneration: 3,
      startedAt: 1
    };
    const resync = mockProjectionResync({
      snapshot: { ...snapshot("session-1"), streaming: true },
      changes: emptyChanges("session-1"),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: readyCatalogStatus(),
      eventSequence: 8,
      hostEpoch: 9,
      sessionGeneration: 3,
      activeOperation
    });
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);

    useAppStore.getState().handleAgentConnected(connectionIdentity(9));
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(resync).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalledWith("runtime.initialize", expect.anything());
    expect(useAppStore.getState().operation).toEqual(activeOperation);
    expect(useAppStore.getState().runtime.phase).toBe("busy");
    expect(useLiveTurnStore.getState().authority).toMatchObject({
      hostEpoch: 9,
      operationId: "operation-1",
      sessionGeneration: 3
    });
  });

  it("resynchronizes the active Session after an Electron power resume", async () => {
    useAppStore.setState({ workspace: "/workspace" });
    const resync = mockProjectionResync({
      snapshot: snapshot("session-1"),
      changes: emptyChanges("session-1"),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: readyCatalogStatus(),
      eventSequence: 11,
      hostEpoch: 9,
      sessionGeneration: 3
    });
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);

    useAppStore.getState().handlePowerResume();
    await vi.waitFor(() => expect(useAppStore.getState().runtime).toMatchObject({
      phase: "ready",
      detail: "系统恢复后 Pi 状态已重新同步"
    }));

    expect(resync).toHaveBeenCalledOnce();
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-1",
      sessionGeneration: 3
    });
  });

  it("renews a disconnected Agent Host connection after power resume", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const connectAgentHost = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { connectAgentHost } } }
    });
    try {
      useAppStore.setState({
        workspace: "/workspace",
        connected: false,
        hostEpoch: 9,
        runtime: { phase: "recovering", detail: "等待系统恢复", recoverable: true }
      });
      vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(undefined);
      vi.spyOn(agentConnectionController, "waitForConnection").mockResolvedValue(connectionIdentity(9));

      useAppStore.getState().handlePowerResume();
      await vi.waitFor(() => expect(connectAgentHost).toHaveBeenCalledOnce());

      expect(useAppStore.getState()).toMatchObject({
        connected: false,
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "系统已恢复，正在重新连接 Agent Host" }
      });
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("restores the interrupted Operation terminal instead of returning it to busy", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { connectAgentHost: vi.fn(async () => undefined) } } }
    });
    try {
      const running = {
        operationId: "operation-terminal-recovery",
        kind: "command" as const,
        lifecycle: "running" as const,
        cancellable: true,
        sessionId: "session-1",
        sessionGeneration: 3,
        startedAt: 10
      };
      useAppStore.setState({ workspace: "/workspace", operation: running });
      vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(undefined);
      vi.spyOn(agentConnectionController, "waitForConnection").mockResolvedValue(connectionIdentity(9));
      mockProjectionResync({
        snapshot: snapshot("session-1"),
        changes: emptyChanges("session-1"),
        extensionCatalog: { items: [], total: 0, truncated: false },
        sessionCatalogStatus: readyCatalogStatus(),
        eventSequence: 9,
        hostEpoch: 9,
        sessionGeneration: 3,
        latestOperationTerminal: terminalReceipt(running.operationId, "command")
      });
      vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);

      useAppStore.getState().handleAgentTeardown(new Error("Port closed"));
      useAppStore.getState().handleAgentConnected(connectionIdentity(9));
      await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

      expect(useAppStore.getState().operation).toMatchObject({
        operationId: running.operationId,
        lifecycle: "completed",
        cancellable: false
      });
      expect(useAppStore.getState().runtime).toMatchObject({ phase: "ready", detail: "任务已完成" });
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("requests one bounded Port renewal when an established workspace connection tears down", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const connectAgentHost = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { connectAgentHost } } }
    });
    try {
      useAppStore.setState({
        workspace: "/workspace",
        connected: true,
        connectionIdentity: connectionIdentity(9),
        hostEpoch: 9
      });
      vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(undefined);
      vi.spyOn(agentConnectionController, "waitForConnection").mockResolvedValue(connectionIdentity(9));

      useAppStore.getState().handleAgentTeardown(new Error("Port closed"));
      await vi.waitFor(() => expect(connectAgentHost).toHaveBeenCalledOnce());

      expect(useAppStore.getState().connected).toBe(false);
      expect(useAppStore.getState().runtime.phase).toBe("recovering");
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("does not begin a live Turn when prompt acceptance arrives after a Session switch", async () => {
    let resolvePrompt!: (value: unknown) => void;
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(connectionIdentity(9));
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise((resolve) => {
      resolvePrompt = resolve;
    }) as never);

    const sending = submitRendererPrompt(
      "keep this draft",
      [],
      "send",
      "submission-session-1"
    );
    setSessionState("session-2", 4);
    resolvePrompt({
      kind: "accepted",
      operationId: "operation-session-2",
      cancellable: true,
      hostEpoch: 9,
      sessionId: "session-2",
      sessionGeneration: 4
    });

    await expect(sending).resolves.toEqual({
      accepted: false,
      error: "发送期间 Pi 会话已切换，旧确认已忽略"
    });
    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useAppStore.getState().runtime.phase).not.toBe("busy");
    expect(useConversationStore.getState().streaming).toBe(false);
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
    expect(useNotificationStore.getState().items.at(-1)?.message).toContain("草稿和附件已保留");
  });

  it("keeps a replayed terminal Prompt settled instead of downgrading it to accepted", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(connectionIdentity(9));
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      terminalReceipt("operation-settled-prompt", "prompt") as never
    );

    await expect(submitRendererPrompt("already delivered", [], "send", "submission-1"))
      .resolves.toEqual({ accepted: true, operationId: "operation-settled-prompt" });
    expect(useAppStore.getState().operation).toMatchObject({
      operationId: "operation-settled-prompt",
      lifecycle: "completed",
      cancellable: false
    });
    expect(useAppStore.getState().runtime.phase).toBe("ready");
    expect(useConversationStore.getState().streaming).toBe(false);
  });
});

function setSessionState(sessionId: string, sessionGeneration: number): void {
  useAppStore.setState({
    connected: true,
    hostEpoch: 9
  });
  const authority = installSessionProjectionFixture(
    useAppStore.getState(),
    snapshot(sessionId),
    sessionGeneration
  );
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useWorkspaceChangesStore.getState().beginSession(authority);
}

function emitChange(change: WorkspaceChangeView): void {
  const event = {
    type: "workspace.changeChanged",
    payload: { sessionId: "session-1", change }
  } as const;
  useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, {
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3
  }));
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
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

function connectionIdentity(hostEpoch: number) {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

function emptyChanges(sessionId: string): WorkspaceChangesProjection {
  return { sessionId, items: [], truncated: false, total: 0 };
}

function readyCatalogStatus() {
  return {
    revision: 2,
    itemCount: 1,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
}

function emptyCatalogPage() {
  return {
    ...readyCatalogStatus(),
    items: [],
    total: 0,
    hasMore: false
  };
}

function mockProjectionResync(result: ProjectionResyncResult) {
  return vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async (install) => install(result));
}

function terminalReceipt(operationId: string, operationKind: "prompt" | "command") {
  return {
    kind: "settled" as const,
    operationId,
    operationKind,
    lifecycle: "completed" as const,
    cancellable: false as const,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 10,
    settledAt: 20
  };
}
