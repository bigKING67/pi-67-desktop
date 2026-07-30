import type { SessionSnapshot, WorkspaceChangeView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";

const runningChange: WorkspaceChangeView = {
  kind: "edit",
  toolCallId: "tool-change-1",
  path: "src/file.ts",
  pathTruncated: false,
  status: "running",
  patchTruncated: false
};

describe("Workbench-selected App projection", () => {
  beforeEach(() => {
    resetStores();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-1",
      displayName: "Workspace",
      identity: { canonicalPath: "/workspace", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    setSessionState("session-1", 3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("clears recorded changes when the active Task bootstraps a new session identity", () => {
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise(() => undefined) as never);
    openWorkbenchTask("task-fixture", "session-1", 3);
    emitChange(runningChange);
    const nextSnapshot = snapshot("session-2");
    const event = { type: "session.bootstrap", payload: { snapshot: nextSnapshot, reason: "session-open" } } as const;
    const envelope = eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "task-fixture",
      sessionId: "session-2",
      sessionGeneration: 4
    }));

    expect(applyRendererAgentEvent(event, envelope)).toBe("active");

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

  it("does not commit a bootstrap from an unregistered Workbench Task", () => {
    emitChange(runningChange);
    const before = useWorkspaceChangesStore.getState();
    const event = {
      type: "session.bootstrap",
      payload: { snapshot: snapshot("session-2"), reason: "session-open" }
    } as const;
    const envelope = eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "missing-task",
      sessionId: "session-2",
      sessionGeneration: 4
    }));

    expect(applyRendererAgentEvent(event, envelope)).toBe("stale");
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-1"
    });
    expect(useWorkspaceChangesStore.getState().projection).toEqual(before.projection);
    expect(useWorkspaceChangesStore.getState().status).toBe(before.status);
  });
});

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useConversationStore.getState().reset();
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}

function setSessionState(sessionId: string, sessionGeneration: number): void {
  useAppStore.setState({ connected: true, hostEpoch: 9 });
  const authority = installSessionProjectionFixture(useAppStore.getState(), snapshot(sessionId), sessionGeneration);
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useWorkspaceChangesStore.getState().beginSession(authority);
}

function openWorkbenchTask(taskId: string, sessionId: string, sessionGeneration: number): void {
  rendererWorkbenchStore.getState().openTask({
    id: taskId,
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionPath: `/sessions/${sessionId}.jsonl`
    },
    workspaceId: "workspace-1",
    sessionId,
    sessionGeneration,
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true },
    title: sessionId,
    hasDraft: false,
    attachmentCount: 0
  });
}

function emitChange(change: WorkspaceChangeView): void {
  const event = { type: "workspace.changeChanged", payload: { sessionId: "session-1", change } } as const;
  useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, taskEventFixture({
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3
  })));
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
