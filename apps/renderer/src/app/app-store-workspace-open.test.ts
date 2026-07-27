import type { RuntimeCapabilities, SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
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
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { openRendererWorkspace } from "../workspace/workspace-open-controller.js";
import { useAppStore } from "./app-store.js";

describe("App Store workspace open authority", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    installSessionProjectionFixture(
      useAppStore.getState(),
      snapshot("session-1"),
      3
    );
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(connectionIdentity(9));
    vi.stubGlobal("window", {
      pi67: {
        system: {
          selectWorkspace: vi.fn().mockResolvedValue("/workspace-next")
        }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStores();
  });

  it("keeps runtime.ready state when workspace.open rejects after the authoritative event", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.open") {
        const readySnapshot = snapshot("session-2");
        const payload = { capabilities: runtimeCapabilities(), snapshot: readySnapshot };
        useAppStore.getState().receiveAgentEvent(
          { type: "runtime.ready", payload },
          eventEnvelope("runtime.ready", payload, {
            hostEpoch: 9,
            sequence: 2,
            sessionId: "session-2",
            sessionGeneration: 4
          })
        );
        throw new Error("late workspace rejection");
      }
      if (type === "workspace.changes") return emptyChanges("session-2") as never;
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await openRendererWorkspace();

    expect(useAppStore.getState()).toMatchObject({
      workspace: "/workspace-next",
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("fails closed when workspace.open returns without authoritative runtime.ready", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      projectionAcknowledgement("session-2", 4) as never
    );

    await openRendererWorkspace();

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: "无法打开工作区：Agent Host 未发送 authoritative runtime.ready 事件。"
      }
    });
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法打开工作区"
    });
  });
});

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

function runtimeCapabilities(): RuntimeCapabilities {
  return {
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
}

function projectionAcknowledgement(sessionId: string, sessionGeneration: number) {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId,
    sessionGeneration,
    eventSequence: 2
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
