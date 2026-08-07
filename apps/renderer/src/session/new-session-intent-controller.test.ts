import type { WorkspaceDescriptor } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  submitRendererPrompt,
  type PromptSubmissionResult
} from "../composer/prompt-submission-controller.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  submitRendererNewSessionIntent
} from "./new-session-intent-controller.js";
import {
  materializeRendererSessionIntent,
  type RendererSessionMaterializationResult
} from "./session-lifecycle-controller.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import {
  installSessionProjectionFixture,
  sessionSnapshotFixture
} from "./session-projection-test-support.js";

vi.mock("../composer/prompt-submission-controller.js", () => ({
  submitRendererPrompt: vi.fn()
}));

vi.mock("./session-lifecycle-controller.js", () => ({
  materializeRendererSessionIntent: vi.fn()
}));

const materializeIntent = vi.mocked(materializeRendererSessionIntent);
const submitPrompt = vi.mocked(submitRendererPrompt);

describe("new Session intent controller", () => {
  beforeEach(() => {
    vi.useRealTimers();
    materializeIntent.mockReset();
    submitPrompt.mockReset();
    rendererWorkbenchStore.getState().reset();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
    rendererWorkbenchStore.getState().openTask(provisionalTask());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("materializes the selected intent and submits its first Prompt once exact authority is active", async () => {
    materializeIntent.mockImplementation(async () => {
      installMaterializedTask();
      return { status: "materialized" };
    });
    submitPrompt.mockResolvedValue(acceptedPrompt());

    await expect(submitRendererNewSessionIntent(
      "task-intent",
      "第一条消息",
      "submission-1"
    )).resolves.toEqual(acceptedPrompt());

    expect(materializeIntent).toHaveBeenCalledOnce();
    expect(materializeIntent).toHaveBeenCalledWith("task-intent");
    expect(submitPrompt).toHaveBeenCalledOnce();
    expect(submitPrompt).toHaveBeenCalledWith("第一条消息", "send", "submission-1", []);
  });

  it("shares one in-flight materialization and Prompt submission for duplicate clicks", async () => {
    const materialization = deferred<RendererSessionMaterializationResult>();
    materializeIntent.mockReturnValue(materialization.promise);
    submitPrompt.mockResolvedValue(acceptedPrompt());

    const first = submitRendererNewSessionIntent("task-intent", "只发送一次", "submission-1");
    const second = submitRendererNewSessionIntent("task-intent", "只发送一次", "submission-1");

    expect(second).toBe(first);
    expect(materializeIntent).toHaveBeenCalledOnce();
    installMaterializedTask();
    materialization.resolve({ status: "materialized" });

    await expect(first).resolves.toEqual(acceptedPrompt());
    expect(submitPrompt).toHaveBeenCalledOnce();
  });

  it.each([
    { status: "failed" as const, error: "create failed" },
    { status: "unconfirmed" as const, error: "creation outcome unknown" }
  ])("does not submit a Prompt when materialization returns $status", async (result) => {
    materializeIntent.mockResolvedValue(result);

    await expect(submitRendererNewSessionIntent(
      "task-intent",
      "保留草稿",
      "submission-1"
    )).resolves.toEqual({ accepted: false, error: result.error });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it("does not create again or submit when the created Session has not bound to the intent Task", async () => {
    vi.useFakeTimers();
    materializeIntent.mockResolvedValue({ status: "materialized" });

    const submission = submitRendererNewSessionIntent(
      "task-intent",
      "稍后重试",
      "submission-1"
    );
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(submission).resolves.toMatchObject({
      accepted: false,
      error: expect.stringContaining("界面尚未完成绑定")
    });
    expect(materializeIntent).toHaveBeenCalledOnce();
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "首条消息尚未发送"
    });
  });

  it("keeps the materialized Session when its first Prompt submission fails", async () => {
    materializeIntent.mockImplementation(async () => {
      installMaterializedTask();
      return { status: "materialized" };
    });
    const failure = { accepted: false as const, error: "prompt failed" };
    submitPrompt.mockResolvedValue(failure);

    await expect(submitRendererNewSessionIntent(
      "task-intent",
      "发送失败仍保留",
      "submission-1"
    )).resolves.toEqual(failure);

    expect(rendererWorkbenchStore.getState().tasks["task-intent"]).toMatchObject({
      conversation: {
        kind: "session",
        sessionFileIdentity: "session-file-1",
        sessionPath: "/sessions/session-1.jsonl"
      },
      sessionId: "session-1",
      sessionGeneration: 3
    });
    expect(materializeIntent).toHaveBeenCalledOnce();
    expect(submitPrompt).toHaveBeenCalledOnce();
  });

  it("checks the shared run limit before creating a Pi Session", async () => {
    for (let index = 0; index < 8; index += 1) {
      rendererWorkbenchStore.getState().openTask(runningTask(index));
    }
    rendererWorkbenchStore.getState().selectTask("task-intent");

    await expect(submitRendererNewSessionIntent(
      "task-intent",
      "不要创建空会话",
      "submission-1"
    )).resolves.toMatchObject({
      accepted: false,
      error: expect.stringContaining("已有 8 个会话任务")
    });

    expect(materializeIntent).not.toHaveBeenCalled();
    expect(submitPrompt).not.toHaveBeenCalled();
  });
});

function installMaterializedTask(): void {
  rendererWorkbenchStore.getState().updateTask("task-intent", {
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1",
      sessionPath: "/sessions/session-1.jsonl"
    },
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionPath: "/sessions/session-1.jsonl",
    sessionGeneration: 3,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true },
    creationId: undefined,
    creationStatus: undefined
  });
  const authority = installSessionProjectionFixture(
    { connected: true, hostEpoch: 9 },
    sessionSnapshotFixture({
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionPath: "/sessions/session-1.jsonl"
    }),
    3
  );
  if (!authority) throw new Error("Expected exact active Session projection.");
}

function workspace(): WorkspaceDescriptor {
  return {
    id: "workspace-1",
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function provisionalTask(): RendererWorkbenchTask {
  return {
    id: "task-intent",
    conversation: { kind: "provisional", workspaceId: "workspace-1", draftId: "task-intent" },
    workspaceId: "workspace-1",
    sessionId: "pending:task-intent",
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "首条消息尚未发送", recoverable: true },
    title: "新对话",
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto"
  };
}

function acceptedPrompt(): PromptSubmissionResult {
  return { accepted: true, operationId: "operation-1", retainsAttachmentPreviews: false };
}

function runningTask(index: number): RendererWorkbenchTask {
  const id = `task-running-${index}`;
  return {
    id,
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionFileIdentity: `session-file-running-${index}`,
      sessionPath: `/sessions/running-${index}.jsonl`
    },
    workspaceId: "workspace-1",
    sessionId: `session-running-${index}`,
    sessionFileIdentity: `session-file-running-${index}`,
    sessionPath: `/sessions/running-${index}.jsonl`,
    sessionGeneration: index + 1,
    taskGeneration: 1,
    lifecycle: "running",
    runtime: { phase: "busy", detail: "running", recoverable: true },
    title: id,
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    operationId: `operation-running-${index}`
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
