import type { WorkspaceChangesProjection } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { refreshWorkspaceChanges } from "./workspace-changes-controller.js";
import { useWorkspaceChangesStore } from "./workspace-changes-store.js";

const AUTHORITY = {
  hostEpoch: 7,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-one",
  sessionGeneration: 3,
  projectionRevision: 1
};

describe("workspace changes controller", () => {
  beforeEach(() => {
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useSessionProjectionStore.setState({ authority: { phase: "active", ...AUTHORITY } });
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useWorkspaceChangesStore.getState().beginSession(AUTHORITY);
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-1",
      displayName: "Workspace 1",
      identity: { canonicalPath: "/work/one", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    rendererWorkbenchStore.getState().openTask({
      id: "task-1",
      conversation: {
        kind: "session",
        workspaceId: "workspace-1",
        sessionFileIdentity: "session-file-one",
        sessionPath: "/sessions/one.jsonl"
      },
      workspaceId: "workspace-1",
      sessionId: AUTHORITY.sessionId,
      sessionGeneration: AUTHORITY.sessionGeneration,
      taskGeneration: 2,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "Task 1",
      sessionPath: "/sessions/one.jsonl",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the current Session projection", async () => {
    const expected = projection("session-1", "tool-current");
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(expected as never);

    await refreshWorkspaceChanges();

    expect(request).toHaveBeenCalledWith("workspace.changes", {}, [], {
      context: {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 2,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-one",
        sessionGeneration: 3
      }
    });
    expect(useWorkspaceChangesStore.getState()).toMatchObject({
      projection: expected,
      status: "ready"
    });
  });

  it("drops a delayed success after the Session changes", async () => {
    const pending = deferred<WorkspaceChangesProjection>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const refresh = refreshWorkspaceChanges();
    useWorkspaceChangesStore.getState().beginSession({
      hostEpoch: 7,
      sessionId: "session-2",
      sessionFileIdentity: "session-file-two",
      sessionGeneration: 4,
      projectionRevision: 2
    });
    pending.resolve(projection("session-1", "tool-old"));
    await refresh;

    expect(useWorkspaceChangesStore.getState()).toMatchObject({
      authority: { sessionId: "session-2" },
      projection: undefined,
      status: "stale"
    });
  });

  it("drops a delayed rejection after teardown without publishing noise", async () => {
    const pending = deferred<WorkspaceChangesProjection>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const refresh = refreshWorkspaceChanges();
    useWorkspaceChangesStore.getState().reset("stale");
    pending.reject(new Error("old Port closed"));
    await refresh;

    expect(useWorkspaceChangesStore.getState()).toMatchObject({
      authority: undefined,
      projection: undefined,
      status: "stale"
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("shares one in-flight refresh for the current authority", async () => {
    const pending = deferred<WorkspaceChangesProjection>();
    const request = vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const first = refreshWorkspaceChanges();
    const second = refreshWorkspaceChanges();
    expect(first).toBe(second);
    pending.resolve(projection("session-1", "tool-current"));
    await Promise.all([first, second]);

    expect(request).toHaveBeenCalledOnce();
    expect(useWorkspaceChangesStore.getState().projection?.items[0]?.toolCallId).toBe("tool-current");
  });

  it("uses the matching Task authority while Settings is the selected surface", async () => {
    rendererWorkbenchStore.getState().openSettings("providers");
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      projection("session-1", "tool-settings") as never
    );

    await refreshWorkspaceChanges();

    expect(request).toHaveBeenCalledOnce();
    expect(useWorkspaceChangesStore.getState().projection?.items[0]?.toolCallId).toBe("tool-settings");
  });

  it("does not request Task-scoped changes when no matching Task authority exists", async () => {
    rendererWorkbenchStore.getState().reset();
    const request = vi.spyOn(agentConnectionController, "request");

    await refreshWorkspaceChanges();

    expect(request).not.toHaveBeenCalled();
    expect(useWorkspaceChangesStore.getState().status).toBe("stale");
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("keeps the current projection stale and reports a current failure", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("read failed"));

    await refreshWorkspaceChanges();

    expect(useWorkspaceChangesStore.getState().status).toBe("stale");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "无法加载本会话修改记录",
      message: "read failed"
    });
  });

  it("rejects a response for another Session instead of remaining loading", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      projection("session-other", "tool-other") as never
    );

    await refreshWorkspaceChanges();

    expect(useWorkspaceChangesStore.getState()).toMatchObject({ projection: undefined, status: "stale" });
    expect(useNotificationStore.getState().items.at(-1)?.message).toContain("different Session");
  });
});

function projection(sessionId: string, toolCallId: string): WorkspaceChangesProjection {
  return {
    sessionId,
    items: [{
      toolCallId,
      kind: "edit",
      path: `src/${toolCallId}.ts`,
      pathTruncated: false,
      status: "completed",
      patchTruncated: false
    }],
    truncated: false,
    total: 1
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
