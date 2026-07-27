import type { OperationView, SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
import type { OperationAccepted, OperationSettled, ProjectionResyncResult } from "@pi67/protocol";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { importRendererSessionFile } from "../session/session-import-controller.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { useAppStore } from "./app-store.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";
import {
  invalidateSessionImportBootstrapWatchdog,
  SESSION_IMPORT_BOOTSTRAP_GRACE_MS
} from "./session-import-bootstrap-watchdog.js";

describe("renderer session import transaction", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        pi67: {
          system: {
            selectSessionFile: vi.fn(async () => "/external/import.jsonl")
          }
        }
      }
    });
    setActiveSession("session-old", 3);
  });

  afterEach(() => {
    invalidateSessionImportBootstrapWatchdog();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetStores();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("does not let a late terminal replay overwrite bootstrap and a newer transition", async () => {
    const deferred = deferredImport();
    mockRequests(deferred.promise);
    const importing = importRendererSessionFile();
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(true));
    useAppStore.setState({ operation: importOperation("session-old", 3) });
    emitImportBootstrap("session-imported", 7);
    expect(useAppStore.getState().sessionTransitionPending).toBe(false);

    prepareRendererSessionTransaction("session-control");
    useAppStore.setState({
      operation: undefined,
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "Newer transition", recoverable: true }
    });
    deferred.resolve(completedReceipt());
    await importing;

    expect(useAppStore.getState()).toMatchObject({
      operation: undefined,
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "Newer transition" }
    });
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-imported",
      sessionGeneration: 7
    });
  });

  it("drops a late rejection after bootstrap instead of clearing newer pending state", async () => {
    const deferred = deferredImport();
    mockRequests(deferred.promise);
    const importing = importRendererSessionFile();
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(true));
    useAppStore.setState({ operation: importOperation("session-old", 3) });
    emitImportBootstrap("session-imported", 7);

    useAppStore.setState({
      operation: undefined,
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "Newer transition", recoverable: true }
    });
    deferred.reject(new Error("Old import rejection"));
    await importing;

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "Newer transition" }
    });
    expect(useNotificationStore.getState().items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Old import rejection" })
    ]));
  });

  it("resynchronizes once when a completed replay arrives without authoritative bootstrap", async () => {
    vi.useFakeTimers();
    mockRequests(Promise.resolve(completedReceipt()));
    const resync = mockProjectionResync(
      importResyncResult()
    );

    await importRendererSessionFile();

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: {
        phase: "recovering",
        detail: "正在确认导入后的 Pi 会话"
      }
    });
    expect(resync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SESSION_IMPORT_BOOTSTRAP_GRACE_MS);
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(resync).toHaveBeenCalledOnce();
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-imported",
      sessionGeneration: 7
    });
    expect(useAppStore.getState()).toMatchObject({
      operation: {
        operationId: "operation-import",
        lifecycle: "completed",
        sessionId: "session-imported",
        sessionGeneration: 7
      },
      runtime: { phase: "ready", detail: "任务已完成" }
    });
  });

  it("resynchronizes when an imported-Session terminal arrives before Bootstrap", async () => {
    vi.useFakeTimers();
    mockRequests(Promise.resolve(acceptedReceipt()));
    const resync = mockProjectionResync(
      importResyncResult()
    );

    await importRendererSessionFile();
    const terminal = {
      type: "operation.completed",
      payload: { operationId: "operation-import", completedAt: 2 }
    } as const;
    useAppStore.getState().receiveAgentEvent(terminal, eventEnvelope(terminal.type, terminal.payload, {
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-imported",
      sessionGeneration: 7,
      operationId: "operation-import"
    }));

    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "recovering",
      detail: "正在确认导入后的 Pi 会话"
    });
    await vi.advanceTimersByTimeAsync(SESSION_IMPORT_BOOTSTRAP_GRACE_MS);
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(resync).toHaveBeenCalledOnce();
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-imported",
      sessionGeneration: 7
    });
  });
});

function mockRequests(importResponse: Promise<unknown>): void {
  vi.spyOn(agentConnectionController, "request").mockImplementation((type) => (
    type === "session.import"
      ? importResponse
      : type === "workspace.changes"
        ? Promise.resolve({
            sessionId: "session-imported",
            items: [],
            truncated: false,
            total: 0
          })
      : Promise.resolve(emptyCatalogPage())
  ) as never);
}

function emitImportBootstrap(sessionId: string, sessionGeneration: number): void {
  const next = snapshot(sessionId);
  const event = {
    type: "session.bootstrap",
    payload: { snapshot: next, reason: "session-import" }
  } as const;
  useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, {
    hostEpoch: 9,
    sequence: 1,
    sessionId,
    sessionGeneration,
    operationId: "operation-import"
  }));
}

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

function importOperation(sessionId: string, sessionGeneration: number): OperationView {
  return {
    operationId: "operation-import",
    kind: "session-import",
    lifecycle: "running",
    cancellable: false,
    sessionId,
    sessionGeneration,
    startedAt: 1
  };
}

function completedReceipt(): OperationSettled {
  return {
    kind: "settled",
    operationId: "operation-import",
    operationKind: "session-import",
    lifecycle: "completed",
    cancellable: false,
    hostEpoch: 9,
    sessionId: "session-imported",
    sessionGeneration: 7,
    startedAt: 1,
    settledAt: 2
  };
}

function acceptedReceipt(): OperationAccepted {
  return {
    kind: "accepted",
    operationId: "operation-import",
    cancellable: false,
    hostEpoch: 9,
    sessionId: "session-old",
    sessionGeneration: 3
  };
}

function importResyncResult(): ProjectionResyncResult {
  return {
    snapshot: snapshot("session-imported"),
    changes: emptyChanges("session-imported"),
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1,
      itemCount: 1,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    },
    eventSequence: 2,
    hostEpoch: 9,
    sessionGeneration: 7,
    latestOperationTerminal: completedReceipt()
  };
}

function mockProjectionResync(result: ProjectionResyncResult) {
  return vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async (install) => install(result));
}

function emptyChanges(sessionId: string): WorkspaceChangesProjection {
  return { sessionId, items: [], truncated: false, total: 0 };
}

function deferredImport() {
  let resolve!: (value: OperationSettled) => void;
  let reject!: (error: Error) => void;
  return {
    promise: new Promise<OperationSettled>((done, fail) => {
      resolve = done;
      reject = fail;
    }),
    resolve,
    reject
  };
}

function emptyCatalogPage() {
  return {
    items: [],
    total: 0,
    hasMore: false,
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
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

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
}
