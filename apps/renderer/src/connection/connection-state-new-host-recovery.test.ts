import type { RuntimeCapabilities, SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { agentConnectionController } from "./AgentConnectionController.js";

const RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  sdkVersion: "0.81.1",
  supportsFollowUp: true,
  supportsSessionTree: true,
  extensionUi: {
    primitives: [],
    attribution: "none",
    recognizedCompatibilityLevels: [],
    adapterRegistry: {
      available: false,
      manifestSchemaVersions: [],
      supportedSurfaces: [],
      realtimeUiAttribution: false,
      activeAdapterCount: 0
    },
    limitations: {
      workingIndicator: "unsupported",
      editorMutation: "unsupported",
      customComponents: "tui-only",
      autocomplete: "tui-only",
      widgetPlacements: []
    }
  }
};

describe("new Host Session recovery", () => {
  beforeEach(() => {
    resetStores();
    const previousSnapshot = snapshot();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: 9,
      trust: "trusted",
      approvalMode: "guided",
      runtime: { phase: "recovering", detail: "等待恢复", recoverable: true }
    });
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      previousSnapshot,
      3
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("keeps recovery semantics when runtime.ready wins the initialize response race", async () => {
    const resync = vi.spyOn(agentConnectionController, "resyncProjection");
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "runtime.initialize") {
        const restoredSnapshot = snapshot();
        const payload = { capabilities: RUNTIME_CAPABILITIES, snapshot: restoredSnapshot };
        useAppStore.getState().receiveAgentEvent(
          { type: "runtime.ready", payload },
          eventEnvelope("runtime.ready", payload, {
            hostEpoch: 10,
            sequence: 1,
            sessionId: restoredSnapshot.sessionId,
            sessionGeneration: 3
          })
        );
        return projectionAcknowledgement(10, restoredSnapshot.sessionId, 3, 1) as never;
      }
      if (type === "workspace.changes") return emptyChanges() as never;
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    useAppStore.getState().handleAgentConnected(connectionIdentity(10));
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(resync).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("runtime.initialize", {
      cwd: "/workspace",
      sessionPath: "/sessions/session-1.jsonl",
      trust: "trusted",
      approvalMode: "guided"
    });
    expect(useAppStore.getState()).toMatchObject({
      hostEpoch: 10,
      runtime: { phase: "ready", detail: "Pi 会话已恢复" }
    });
  });

  it("does not roll back an installed runtime.ready projection when initialize rejects late", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "runtime.initialize") {
        const restoredSnapshot = snapshot();
        const payload = { capabilities: RUNTIME_CAPABILITIES, snapshot: restoredSnapshot };
        useAppStore.getState().receiveAgentEvent(
          { type: "runtime.ready", payload },
          eventEnvelope("runtime.ready", payload, {
            hostEpoch: 10,
            sequence: 1,
            sessionId: restoredSnapshot.sessionId,
            sessionGeneration: 3
          })
        );
        throw new Error("late initialize rejection");
      }
      if (type === "workspace.changes") return emptyChanges() as never;
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    useAppStore.getState().handleAgentConnected(connectionIdentity(10));
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState()).toMatchObject({
      hostEpoch: 10,
      runtime: { phase: "ready", detail: "Pi 会话已恢复" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });
});

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    sessionPath: "/sessions/session-1.jsonl",
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

function emptyChanges(): WorkspaceChangesProjection {
  return { sessionId: "session-1", items: [], truncated: false, total: 0 };
}

function emptyCatalogPage() {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    items: [],
    total: 0,
    hasMore: false
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

function projectionAcknowledgement(
  hostEpoch: number,
  sessionId: string,
  sessionGeneration: number,
  eventSequence: number
) {
  return {
    accepted: true as const,
    hostEpoch,
    sessionId,
    sessionGeneration,
    eventSequence
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
