import type { SessionSnapshot } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import {
  selectCommittedExtensionCatalog,
  useExtensionUiStore
} from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  installRendererSessionResync,
  replaceRendererSessionSnapshot
} from "./renderer-session-installation.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";

describe("renderer session transaction", () => {
  beforeEach(() => {
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
    useConversationStore.setState(useConversationStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-1",
      displayName: "Workspace",
      identity: { canonicalPath: "/workspace", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
  });

  it("invalidates every session projection before a same-Host resync", () => {
    seedFeatureStores();
    prepareRendererSessionTransaction("projection-resync");

    expect(useConversationStore.getState().messages).toEqual([]);
    expect(useWorkspaceChangesStore.getState()).toMatchObject({ projection: undefined, status: "stale" });
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState()).toMatchObject({ requests: [], catalog: undefined });
    expect(catalog().items).toEqual([]);
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: undefined,
      tree: { nodes: [], truncated: false, total: 0 },
      status: "stale"
    });
    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { phase: "inactive", projectionRevision: 2 },
      identity: undefined,
      controls: undefined
    });
  });

  it("preserves settled conversation and changes during same-session control work", () => {
    seedFeatureStores();
    prepareRendererSessionTransaction("session-control");

    expect(useConversationStore.getState().messages).toHaveLength(1);
    expect(useWorkspaceChangesStore.getState().projection?.items).toHaveLength(1);
    expect(catalog().items).toHaveLength(1);
    expect(useSessionTreeStore.getState().tree.nodes).toHaveLength(1);
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
  });

  it("replaces a switched Session projection and clears old interactive state", () => {
    seedFeatureStores();
    const installed = replaceRendererSessionSnapshot(appState(), snapshot("session-2"), {
      sessionGeneration: 6
    });

    expect(installed).toBe(true);
    expect(useConversationStore.getState().authority).toMatchObject({
      hostEpoch: 9,
      sessionId: "session-2",
      sessionGeneration: 6
    });
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: { hostEpoch: 9, sessionId: "session-2", sessionGeneration: 6 },
      status: "ready"
    });
    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: {
        phase: "active",
        hostEpoch: 9,
        sessionId: "session-2",
        sessionGeneration: 6,
        projectionRevision: 2
      },
      identity: { sessionPath: "/sessions/session-2.jsonl", cwd: "/workspace" }
    });
    expect(useWorkspaceChangesStore.getState().projection).toBeUndefined();
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().catalog).toBeUndefined();
  });

  it("installs resync snapshot, changes, extension catalog, and catalog status together", () => {
    const result = {
      snapshot: snapshot("session-1"),
      changes: changes("session-1"),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: catalogStatus(),
      eventSequence: 8,
      hostEpoch: 9,
      sessionGeneration: 3,
      taskToolMode: "auto" as const
    };
    const target = useSessionProjectionStore.getState().captureTransition(appState())!;
    const installed = installRendererSessionResync(appState(), result, 9, target, "workspace-1");

    expect(installed).toBe(true);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionGeneration: 3
    });
    expect(useConversationStore.getState().authority?.sessionId).toBe("session-1");
    expect(useWorkspaceChangesStore.getState().projection).toEqual(result.changes);
    expect(selectCommittedExtensionCatalog(
      useExtensionUiStore.getState().catalog,
      useSessionProjectionStore.getState().authority
    )).toEqual(result.extensionCatalog);
    expect(catalog()).toMatchObject({ revision: 2, catalogState: "ready" });
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: { sessionId: "session-1", sessionGeneration: 3 },
      status: "ready"
    });
  });

  it("does not install catalog status when resync has no Workspace authority", () => {
    rendererWorkbenchStore.getState().reset();
    const result = {
      snapshot: snapshot("session-1"),
      changes: changes("session-1"),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: catalogStatus(),
      eventSequence: 8,
      hostEpoch: 9,
      sessionGeneration: 3,
      taskToolMode: "auto" as const
    };
    const target = useSessionProjectionStore.getState().captureTransition(appState())!;

    expect(installRendererSessionResync(appState(), result, 9, target, undefined)).toBe(true);
    expect(useSessionCatalogStore.getState().byWorkspace).toEqual({});
  });

  it("stops an old snapshot transaction when the canonical Store subscriber starts a newer one", () => {
    seedFeatureStores();
    let superseded = false;
    const unsubscribe = useSessionProjectionStore.subscribe((state, previous) => {
      if (
        superseded
        || previous.authority.phase !== "active"
        || state.authority.phase !== "inactive"
      ) return;
      superseded = true;
      prepareRendererSessionTransaction("host-replaced");
    });

    const installed = replaceRendererSessionSnapshot(appState(), snapshot("session-2"), {
      sessionGeneration: 6
    });
    unsubscribe();

    expect(installed).toBe(false);
    expect(superseded).toBe(true);
    expect(useSessionProjectionStore.getState().authority).toEqual({
      phase: "inactive",
      projectionRevision: 3
    });
    expect(useConversationStore.getState().messages).toEqual([]);
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: undefined,
      tree: { nodes: [], truncated: false, total: 0 },
      status: "stale"
    });
  });

  it("stops an old snapshot transaction when a feature Store subscriber supersedes it", () => {
    seedFeatureStores();
    let superseded = false;
    const unsubscribe = useConversationStore.subscribe((state) => {
      if (superseded || state.authority?.sessionId !== "session-2") return;
      superseded = true;
      prepareRendererSessionTransaction("host-replaced");
    });

    const installed = replaceRendererSessionSnapshot(appState(), snapshot("session-2"), {
      sessionGeneration: 6
    });
    unsubscribe();

    expect(installed).toBe(false);
    expect(superseded).toBe(true);
    expect(useSessionProjectionStore.getState().authority).toEqual({
      phase: "inactive",
      projectionRevision: 3
    });
    expect(useConversationStore.getState().messages).toEqual([]);
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: undefined,
      tree: { nodes: [], truncated: false, total: 0 },
      status: "stale"
    });
    expect(useExtensionUiStore.getState().catalog).toBeUndefined();
  });

  it("does not let a stale transition target clear a newer committed Session", () => {
    seedFeatureStores();
    const staleTarget = useSessionProjectionStore.getState().captureTransition(appState())!;
    expect(replaceRendererSessionSnapshot(appState(), snapshot("session-new"), {
      sessionGeneration: 7
    })).toBe(true);

    expect(replaceRendererSessionSnapshot(appState(), snapshot("session-old"), {
      sessionGeneration: 4,
      transitionTarget: staleTarget
    })).toBe(false);

    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-new",
      sessionGeneration: 7
    });
    expect(useConversationStore.getState().authority?.sessionId).toBe("session-new");
    expect(useSessionTreeStore.getState().authority?.sessionId).toBe("session-new");
  });

  it("does not commit a resync after its Changes projection is superseded", () => {
    const result = {
      snapshot: snapshot("session-1"),
      changes: changes("session-1"),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: catalogStatus(),
      eventSequence: 8,
      hostEpoch: 9,
      sessionGeneration: 3,
      taskToolMode: "auto" as const
    };
    const target = useSessionProjectionStore.getState().captureTransition(appState())!;
    let superseded = false;
    const unsubscribe = useWorkspaceChangesStore.subscribe((state) => {
      if (superseded || state.status !== "ready") return;
      superseded = true;
      prepareRendererSessionTransaction("host-replaced");
    });

    const installed = installRendererSessionResync(appState(), result, 9, target, "workspace-1");
    unsubscribe();

    expect(installed).toBe(false);
    expect(superseded).toBe(true);
    expect(useSessionProjectionStore.getState().authority).toEqual({
      phase: "inactive",
      projectionRevision: 2
    });
    expect(useWorkspaceChangesStore.getState()).toMatchObject({
      authority: undefined,
      projection: undefined,
      status: "stale"
    });
    expect(useSessionTreeStore.getState().authority).toBeUndefined();
    expect(useExtensionUiStore.getState().catalog).toBeUndefined();
  });
});

function seedFeatureStores(): void {
  const authority = installSessionProjectionFixture(appState(), snapshot("session-1"), 3);
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useConversationStore.getState().replaceSnapshot(snapshot("session-1"), authority);
  useWorkspaceChangesStore.getState().installProjection(authority, changes("session-1"));
  useSessionTreeStore.getState().replaceProjection(authority, snapshot("session-1").tree);
  useLiveTurnStore.getState().begin({
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 1
  }, 9);
  useApprovalStore.getState().upsertRequest({
    requestId: "approval-1",
    toolCallId: "tool-1",
    toolName: "bash",
    toolSource: "Pi 内置",
    category: "ambiguous-command",
    reason: "Confirm",
    targetKind: "command",
    target: "pnpm test",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call"
  });
  useExtensionUiStore.getState().upsertRequest({ requestId: "extension-1", kind: "confirm", blocking: true });
  useExtensionUiStore.getState().installCatalog(authority, { items: [], total: 0, truncated: false });
  useSessionCatalogStore.getState().finishFirstPage(
    useSessionCatalogStore.getState().beginFirstPage("workspace-1"),
    { ...catalogStatus(), items: [{
      id: "session-1",
      path: "/sessions/session-1.jsonl",
      cwd: "/workspace",
      name: "Session 1",
      nameSource: "explicit",
      modifiedAt: 1,
      messageCount: 1
    }], total: 1, hasMore: false }
  );
}

function catalog() {
  return selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), "workspace-1");
}

function appState() {
  return {
    connected: true,
    hostEpoch: 9
  };
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    cwd: "/workspace",
    streaming: false,
    messages: [{ id: "message-1", role: "assistant", parts: [{ type: "text", text: "ready" }] }],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: {
      nodes: [{
        id: "entry-1",
        parentId: null,
        type: "message",
        preview: "ready",
        active: true,
        depth: 0
      }],
      truncated: false,
      total: 1
    },
    resources: []
  };
}

function changes(sessionId: string) {
  return {
    sessionId,
    items: [{
      kind: "edit" as const,
      toolCallId: "tool-1",
      path: "src/file.ts",
      pathTruncated: false,
      status: "completed" as const,
      patchTruncated: false
    }],
    truncated: false,
    total: 1
  };
}

function catalogStatus() {
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
