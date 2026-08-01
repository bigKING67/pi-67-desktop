import type { SessionTreeProjection } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { refreshSessionTree } from "./session-tree-controller.js";
import { useSessionTreeStore } from "./session-tree-store.js";

const AUTHORITY = {
  hostEpoch: 7,
  sessionId: "session-1",
  sessionGeneration: 3,
  projectionRevision: 1
};

describe("session tree controller", () => {
  beforeEach(() => {
    useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useSessionProjectionStore.setState({ authority: { phase: "active", ...AUTHORITY } });
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionTreeStore.getState().replaceProjection(AUTHORITY, tree("initial"));
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
      attachmentCount: 0
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the current authoritative tree", async () => {
    const expected = tree("current");
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(expected as never);

    await refreshSessionTree(AUTHORITY);

    expect(request).toHaveBeenCalledWith("session.tree", {}, [], {
      context: {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 2,
        sessionId: "session-1",
        sessionGeneration: 3
      }
    });
    expect(useSessionTreeStore.getState()).toMatchObject({ tree: expected, status: "ready" });
  });

  it("coalesces an in-flight change and performs one trailing refresh", async () => {
    const firstResponse = deferred<SessionTreeProjection>();
    const secondResponse = deferred<SessionTreeProjection>();
    const request = vi.spyOn(agentConnectionController, "request")
      .mockReturnValueOnce(firstResponse.promise as never)
      .mockReturnValueOnce(secondResponse.promise as never);

    const first = refreshSessionTree(AUTHORITY);
    const second = refreshSessionTree(AUTHORITY);
    expect(first).toBe(second);
    firstResponse.resolve(tree("intermediate"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    secondResponse.resolve(tree("latest"));
    await first;

    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("latest"),
      status: "ready"
    });
  });

  it("drops a delayed rejection after teardown without notification noise", async () => {
    const pending = deferred<SessionTreeProjection>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const refresh = refreshSessionTree(AUTHORITY);
    useSessionTreeStore.getState().reset("stale");
    pending.reject(new Error("old Port closed"));
    await refresh;

    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: undefined,
      status: "stale"
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("retries one transient BUSY response without showing a warning", async () => {
    const expected = tree("after-transition");
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new ProtocolRequestError({
        code: "BUSY",
        message: "A session transition is in progress.",
        recoverable: true,
        retryAfterMs: 0,
        details: { retryable: true }
      }))
      .mockResolvedValueOnce(expected as never);

    await refreshSessionTree(AUTHORITY);

    expect(request).toHaveBeenCalledTimes(2);
    expect(useSessionTreeStore.getState()).toMatchObject({ tree: expected, status: "ready" });
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("does not expose a raw Host BUSY message after the bounded retry", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new ProtocolRequestError({
      code: "BUSY",
      message: "A session transition is in progress.",
      recoverable: true,
      retryAfterMs: 0,
      details: { retryable: true }
    }));

    await refreshSessionTree(AUTHORITY);

    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "无法刷新会话树",
      message: "Pi 正在完成其他会话操作，会话树将在下次状态变化时重新同步。"
    });
  });

  it("reports a current refresh failure and preserves the last tree", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("tree read failed"));

    await refreshSessionTree(AUTHORITY);

    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("initial"),
      status: "stale"
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "无法刷新会话树",
      message: "tree read failed"
    });
  });

  it("uses the matching Task authority while Settings is selected", async () => {
    rendererWorkbenchStore.getState().openSettings("skills");
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      tree("settings") as never
    );

    await refreshSessionTree(AUTHORITY);

    expect(request).toHaveBeenCalledOnce();
    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("settings"),
      status: "ready"
    });
  });

  it("does not send a Task command or show an error when no matching Task remains", async () => {
    rendererWorkbenchStore.getState().reset();
    const request = vi.spyOn(agentConnectionController, "request");

    await refreshSessionTree(AUTHORITY);

    expect(request).not.toHaveBeenCalled();
    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("initial"),
      status: "stale"
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });
});

function tree(preview: string): SessionTreeProjection {
  return {
    nodes: [{
      id: `entry-${preview}`,
      parentId: null,
      type: "message",
      preview,
      active: true,
      depth: 0
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
