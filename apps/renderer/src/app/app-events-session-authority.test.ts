import type { OperationView, SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import {
  selectCommittedExtensionCatalog,
  useExtensionUiStore
} from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { currentRendererSessionAuthority } from "../session/session-authority.js";
import { useAppStore } from "./app-store.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";

describe("app events renderer session authority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
    useConversationStore.setState(useConversationStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      sessionId: "session-2",
      items: [],
      truncated: false,
      total: 0
    } as never);
  });

  it("drops an old Operation event after the Session transaction is invalidated", () => {
    setActiveSession("session-1", 3);
    prepareRendererSessionTransaction("session-replaced");
    useAppStore.setState({ sessionTransitionPending: true });

    emitOperationStarted(operation("session-1", 3));

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
  });

  it("drops ordinary Session events until a bootstrap installs authoritative generation", () => {
    useAppStore.setState({
      connected: true,
      hostEpoch: 9
    });

    emitOperationStarted(operation("session-2", 7));

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
  });

  it("stages a pre-bootstrap Extension Catalog and installs only an exact generation match", () => {
    setActiveSession("session-1", 3);
    prepareRendererSessionTransaction("session-replaced");
    useAppStore.setState({ sessionTransitionPending: true });
    const catalog = { items: [], total: 2, truncated: false };
    useAppStore.getState().receiveAgentEvent({
      type: "extension.catalog.changed",
      payload: catalog
    }, eventEnvelope("extension.catalog.changed", catalog, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-2",
      sessionGeneration: 7
    })));
    expect(committedCatalog()).toBeUndefined();

    const nextSnapshot = snapshot("session-2");
    useAppStore.getState().receiveAgentEvent({
      type: "session.bootstrap",
      payload: { snapshot: nextSnapshot, reason: "session-open" }
    }, eventEnvelope("session.bootstrap", {
      snapshot: nextSnapshot,
      reason: "session-open"
    }, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 7
    })));

    expect(committedCatalog()).toEqual(catalog);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-2",
      sessionGeneration: 7
    });
  });

  it("accepts an Extension Catalog only for the active Renderer Session authority", () => {
    setActiveSession("session-1", 3);
    const catalog = { items: [], total: 1, truncated: false };
    const staleCatalog = { ...catalog, total: 9 };

    useAppStore.getState().receiveAgentEvent({
      type: "extension.catalog.changed",
      payload: catalog
    }, eventEnvelope("extension.catalog.changed", catalog, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3
    })));
    expect(committedCatalog()).toEqual(catalog);

    useAppStore.getState().receiveAgentEvent({
      type: "extension.catalog.changed",
      payload: staleCatalog
    }, eventEnvelope("extension.catalog.changed", staleCatalog, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-1",
      sessionGeneration: 2
    })));
    expect(committedCatalog()).toEqual(catalog);
  });

  it("stages the next Session catalog during an active import and binds the operation to bootstrap authority", () => {
    setActiveSession("session-1", 3);
    const previousCatalog = { items: [], total: 1, truncated: false };
    const importedCatalog = { items: [], total: 2, truncated: false };
    useExtensionUiStore.getState().installCatalog(currentAuthority(), previousCatalog);
    prepareRendererSessionTransaction("session-import");
    useAppStore.setState({
      sessionTransitionPending: true,
      operation: {
        ...operation("session-1", 3),
        operationId: "operation-import",
        kind: "session-import"
      }
    });

    useAppStore.getState().receiveAgentEvent({
      type: "extension.catalog.changed",
      payload: importedCatalog
    }, eventEnvelope("extension.catalog.changed", importedCatalog, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-import"
    })));

    expect(committedCatalog()).toEqual(previousCatalog);
    expect(useExtensionUiStore.getState().stagedCatalog).toMatchObject({
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-import"
    });

    const importedSnapshot = snapshot("session-2");
    useAppStore.getState().receiveAgentEvent({
      type: "session.bootstrap",
      payload: { snapshot: importedSnapshot, reason: "session-import" }
    }, eventEnvelope("session.bootstrap", {
      snapshot: importedSnapshot,
      reason: "session-import"
    }, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-import"
    })));

    expect(committedCatalog()).toEqual(importedCatalog);
    expect(useExtensionUiStore.getState().stagedCatalog).toBeUndefined();
    expect(useAppStore.getState().operation).toMatchObject({
      operationId: "operation-import",
      sessionId: "session-2",
      sessionGeneration: 7
    });
  });
});

function setActiveSession(sessionId: string, sessionGeneration: number): void {
  useAppStore.setState({
    connected: true,
    hostEpoch: 9
  });
  installSessionProjectionFixture(
    useAppStore.getState(),
    snapshot(sessionId),
    sessionGeneration
  );
}

function currentAuthority() {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority) throw new Error("Expected active Renderer Session authority.");
  return authority;
}

function committedCatalog() {
  return selectCommittedExtensionCatalog(
    useExtensionUiStore.getState().catalog,
    useSessionProjectionStore.getState().authority
  );
}

function emitOperationStarted(value: OperationView): void {
  const event = { type: "operation.started", payload: { operation: value } } as const;
  useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, taskEventFixture({
    hostEpoch: 9,
    sequence: 1,
    sessionId: value.sessionId,
    sessionGeneration: value.sessionGeneration,
    operationId: value.operationId
  })));
}

function operation(sessionId: string, sessionGeneration: number): OperationView {
  return {
    operationId: `operation-${sessionId}`,
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId,
    sessionGeneration,
    startedAt: 1
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
