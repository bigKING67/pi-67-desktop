import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import {
  activateRendererNativeNotification,
  handleNativeNotificationAgentEvent,
  initializeNativeNotificationController
} from "./native-notification-controller.js";
import { useNotificationStore } from "./notification-store.js";

vi.mock("../workbench/task-activation-controller.js", () => ({
  activateRendererTask: vi.fn()
}));

vi.mock("../workspace/workspace-open-controller.js", () => ({
  openRendererWorkspaceDescriptor: vi.fn()
}));

const activateTask = vi.mocked(activateRendererTask);
const openWorkspace = vi.mocked(openRendererWorkspaceDescriptor);

describe("renderer native notification controller", () => {
  let visible = true;
  let focused = true;
  let dispose: (() => void) | undefined;
  let activationListener: ((activation: {
    notificationId: string;
    kind: "completed" | "failed" | "attention";
    workspaceId: string;
    sessionFileIdentity: string;
  }) => void) | undefined;
  const showNativeNotification = vi.fn().mockResolvedValue(true);
  const dismissNativeNotification = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    activateTask.mockReset().mockResolvedValue(true);
    openWorkspace.mockReset().mockResolvedValue(true);
    showNativeNotification.mockReset().mockResolvedValue(true);
    dismissNativeNotification.mockReset().mockResolvedValue(true);
    activationListener = undefined;
    visible = true;
    focused = true;
    vi.stubGlobal("document", {
      get visibilityState() {
        return visible ? "visible" : "hidden";
      },
      hasFocus: () => focused,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    vi.stubGlobal("window", {
      pi67: {
        system: {
          showNativeNotification,
          dismissNativeNotification,
          onNativeNotificationActivated: (listener: typeof activationListener) => {
            activationListener = listener;
            return () => {
              activationListener = undefined;
            };
          }
        }
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    rendererWorkbenchStore.getState().reset();
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-1",
      displayName: "Workspace",
      identity: { canonicalPath: "/workspace", assurance: "path-only" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    rendererWorkbenchStore.getState().openTask(task("active"));
    rendererWorkbenchStore.getState().openTask(task("background"));
    rendererWorkbenchStore.getState().selectTask("active");
    dispose = initializeNativeNotificationController();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.unstubAllGlobals();
  });

  it("shows a native notification for a completed background Session without exposing content", async () => {
    handleNativeNotificationAgentEvent(
      { type: "operation.completed", payload: { operationId: "operation-background", completedAt: 2 } },
      envelope("operation.completed", "background", "operation-background"),
      "background"
    );
    await Promise.resolve();

    expect(showNativeNotification).toHaveBeenCalledWith({
      notificationId: "native:9:operation-background:completed",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-background"
    });
  });

  it("does not notify for the visible focused active Session", () => {
    handleNativeNotificationAgentEvent(
      { type: "operation.failed", payload: {
        operationId: "operation-active",
        failedAt: 2,
        error: { code: "INTERNAL", message: "private failure detail", recoverable: true }
      } },
      envelope("operation.failed", "active", "operation-active"),
      "active"
    );

    expect(showNativeNotification).not.toHaveBeenCalled();
  });

  it("notifies for the selected Session while the application is hidden", async () => {
    visible = false;

    handleNativeNotificationAgentEvent(
      { type: "operation.activityChanged", payload: {
        operationId: "operation-active",
        activity: { kind: "approval", requestId: "approval-1" }
      } },
      envelope("operation.activityChanged", "active", "operation-active"),
      "active"
    );
    await Promise.resolve();

    expect(showNativeNotification).toHaveBeenCalledWith(expect.objectContaining({
      notificationId: "native:9:operation-active:attention",
      kind: "attention"
    }));
  });

  it("activates the exact existing Workbench Task when a notification is clicked", async () => {
    const activation = {
      notificationId: "native:9:operation-background:completed",
      kind: "completed" as const,
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-background"
    };

    activationListener?.(activation);
    await Promise.resolve();
    await Promise.resolve();

    expect(dismissNativeNotification).toHaveBeenCalledWith(activation.notificationId);
    expect(activateTask).toHaveBeenCalledWith("background");
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it("waits for Workbench hydration before activating a notification from a recreated window", async () => {
    dispose?.();
    dispose = undefined;
    let resolveWorkbench: (() => void) | undefined;
    const workbenchReady = new Promise<void>((resolve) => {
      resolveWorkbench = resolve;
    });
    dispose = initializeNativeNotificationController(workbenchReady);
    const activation = {
      notificationId: "native:9:operation-background:completed",
      kind: "completed" as const,
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-background"
    };

    activationListener?.(activation);
    await Promise.resolve();
    await Promise.resolve();

    expect(activateTask).not.toHaveBeenCalled();
    resolveWorkbench?.();
    await vi.waitFor(() => expect(activateTask).toHaveBeenCalledWith("background"));
  });

  it("reports a bounded warning when the notification Session is no longer known", async () => {
    await expect(activateRendererNativeNotification({
      notificationId: "native:9:missing:failed",
      kind: "failed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-missing"
    })).resolves.toBe(false);

    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "无法打开通知对应的会话"
    });
  });
});

function task(id: "active" | "background"): RendererWorkbenchTask {
  return {
    id,
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionFileIdentity: `session-file-${id}`,
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId: "workspace-1",
    sessionId: `session-${id}`,
    sessionFileIdentity: `session-file-${id}`,
    sessionPath: `/sessions/${id}.jsonl`,
    sessionGeneration: 2,
    taskGeneration: 1,
    lifecycle: "running",
    runtime: { phase: "busy", detail: "running", recoverable: true },
    title: id,
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    operationId: `operation-${id}`
  };
}

function envelope(
  type: "operation.completed" | "operation.failed" | "operation.activityChanged",
  taskId: "active" | "background",
  operationId: string
) {
  const payload = type === "operation.completed"
    ? { operationId, completedAt: 2 }
    : type === "operation.failed"
      ? { operationId, failedAt: 2, error: { code: "INTERNAL" as const, message: "failed", recoverable: true } }
      : { operationId, activity: { kind: "approval" as const, requestId: "approval-1" } };
  return eventEnvelope(type, payload, taskEventFixture({
    hostEpoch: 9,
    sequence: 2,
    workspaceId: "workspace-1",
    taskId,
    taskGeneration: 1,
    sessionId: `session-${taskId}`,
    sessionFileIdentity: `session-file-${taskId}`,
    sessionGeneration: 2,
    operationId
  }));
}
