import type { OperationView, SessionSnapshot } from "@pi67/domain";
import type { AgentConnectionIdentity, OperationSettled, ProjectionResyncResult } from "@pi67/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { agentConnectionController as controller } from "./AgentConnectionController.js";
import { projectionRecoveryLedger as ledger } from "./projection-recovery-ledger.js";
import { seedAuthoritativeRecoveryTask } from "./projection-recovery-test-support.js";

afterEach(() => {
  vi.restoreAllMocks();
  ledger.clearInterruptedOperation();
  ledger.completeConnectionLoss();
});

it("restores the authoritative failure after repeated Port loss in one recovery incident", async () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useNotificationStore.getState().clear();
  rendererWorkbenchStore.getState().reset();
  seedAuthoritativeRecoveryTask();
  const identity: AgentConnectionIdentity = {
    appInstanceId: "app-1", hostInstanceId: "host-7", hostEpoch: 7,
    sdkVersion: "fixture", eventSequence: 0
  };
  const snapshot: SessionSnapshot = {
    sessionId: "session-1", sessionFileIdentity: "session-file-session-1",
    sessionPath: "/sessions/session-1.jsonl", cwd: "/workspace", streaming: false,
    messages: [], messagePage: { hasOlder: false, hasNewer: false }, models: [], providers: [],
    thinkingLevel: "off", availableThinkingLevels: ["off"], steeringQueue: [], followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 }, resources: []
  };
  const operation: OperationView = {
    operationId: "running-1", kind: "prompt", lifecycle: "running", cancellable: true,
    sessionId: "session-1", sessionFileIdentity: "session-file-session-1",
    sessionGeneration: 3, startedAt: 1
  };
  const terminal: OperationSettled = {
    ...operation, kind: "settled", operationKind: "prompt", lifecycle: "failed",
    cancellable: false, hostEpoch: 7, settledAt: 2,
    error: { code: "INTERNAL", message: "Provider rejected the request", recoverable: true }
  };
  const result: ProjectionResyncResult = {
    sessionId: "session-1", sessionFileIdentity: "session-file-session-1", sessionGeneration: 3,
    hostEpoch: 7, eventSequence: 5, taskToolMode: "auto", snapshot,
    changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1, itemCount: 1, source: "sqlite", state: "ready", rebuilding: false,
      incomplete: false, skippedCount: 0
    },
    latestOperationTerminal: terminal
  };
  useAppStore.setState({
    workspace: "/workspace", connected: true, hostEpoch: 7, connectionIdentity: identity,
    operation, runtime: { phase: "busy", detail: "running", recoverable: true }
  });
  installSessionProjectionFixture({ connected: true, hostEpoch: 7 }, snapshot, 3);
  vi.spyOn(controller, "identity", "get").mockReturnValue(identity);
  vi.spyOn(controller, "request").mockResolvedValue({
    ...result.sessionCatalogStatus, items: [], total: 0, hasMore: false
  });
  vi.spyOn(controller, "resyncProjection").mockImplementation(async (install) => install(result));

  useAppStore.getState().handleAgentTeardown(new Error("port loss 1"));
  expect(ledger.matchingInterruptedTerminal(terminal)).toBeDefined();
  expect(useAppStore.getState().operation).toBeUndefined();
  useAppStore.getState().handleAgentTeardown(new Error("replacement handshake failed"));
  expect(ledger.matchingInterruptedTerminal(terminal)).toBeDefined();
  useAppStore.getState().handleAgentConnected(identity);
  await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

  expect(useAppStore.getState().runtime).toMatchObject({ phase: "failed" });
  expect(useAppStore.getState().operation).toMatchObject({ operationId: "running-1", lifecycle: "failed" });
  expect(useNotificationStore.getState().items.filter((item) => item.operation?.operationId === "running-1"))
    .toEqual([expect.objectContaining({
      level: "error",
      operation: expect.objectContaining({ lifecycle: "failed", errorCode: "INTERNAL" })
    })]);
});
