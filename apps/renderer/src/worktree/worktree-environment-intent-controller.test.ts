import { resolve } from "node:path";
import type { RepositoryEnvironmentSnapshot, WorkspaceDescriptor } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useRepositoryEnvironmentStore } from "./repository-environment-store.js";
import {
  selectRendererTaskEnvironmentIntent,
  worktreeIntentAvailability
} from "./worktree-environment-intent-controller.js";

describe("Worktree environment intent", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useRepositoryEnvironmentStore.getState().reset();
  });

  it("admits Worktree intent only from a fresh ready Repository snapshot", () => {
    const target = task();
    const descriptor = workspace();
    expect(worktreeIntentAvailability(target, descriptor, undefined)).toMatchObject({
      code: "inspecting",
      status: "checking"
    });
    expect(worktreeIntentAvailability(target, descriptor, record(snapshot({ status: "non-git" })))).toMatchObject({
      code: "non-git",
      status: "unavailable"
    });
    expect(worktreeIntentAvailability(target, descriptor, record(snapshot({ stale: true })))).toMatchObject({
      code: "repository-stale",
      status: "unavailable"
    });
    expect(worktreeIntentAvailability(target, descriptor, record(snapshot({
      error: { stage: "state", code: "state-unavailable", recoverable: true }
    })))).toMatchObject({
      code: "binding-unavailable",
      status: "unavailable"
    });
    expect(worktreeIntentAvailability(target, descriptor, record(snapshot()))).toEqual({
      code: "ready",
      status: "available",
      retryable: false
    });
  });

  it("locks the selection after environment creation begins", () => {
    expect(worktreeIntentAvailability(task({
      environmentCreationId: "creation-a",
      environmentCreationState: "workspace-registered"
    }), workspace(), record(snapshot()))).toEqual({
      code: "creation-started",
      status: "locked",
      retryable: false
    });
  });

  it("switches intent without Git side effects and checkpoints a non-empty draft", async () => {
    const descriptor = workspace();
    const target = task();
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    rendererWorkbenchStore.getState().openTask(target);
    installSnapshot(snapshot());
    const persistDraftCheckpoint = vi.fn(async () => undefined);

    await expect(selectRendererTaskEnvironmentIntent(target.id, "worktree", {
      persistDraftCheckpoint
    })).resolves.toBe(true);
    expect(rendererWorkbenchStore.getState().tasks[target.id]?.environmentIntent).toBe("worktree");
    expect(persistDraftCheckpoint).toHaveBeenCalledOnce();

    useRepositoryEnvironmentStore.getState().beginInspection(descriptor.id);
    await expect(selectRendererTaskEnvironmentIntent(target.id, "worktree", {
      persistDraftCheckpoint
    })).resolves.toBe(false);
    await expect(selectRendererTaskEnvironmentIntent(target.id, "local", {
      persistDraftCheckpoint
    })).resolves.toBe(true);
    expect(rendererWorkbenchStore.getState().tasks[target.id]?.environmentIntent).toBe("local");
  });
});

function workspace(): WorkspaceDescriptor {
  return {
    id: "workspace-a",
    displayName: "Workspace A",
    identity: { canonicalPath: resolve("workspace-a"), assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function task(overrides: Partial<RendererWorkbenchTask> = {}): RendererWorkbenchTask {
  return {
    id: "task-a",
    conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: "task-a" },
    workspaceId: "workspace-a",
    sessionId: "pending:task-a",
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "首条消息尚未发送", recoverable: true },
    title: "未命名会话",
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto",
    ...overrides
  };
}

function record(snapshotValue: RepositoryEnvironmentSnapshot) {
  return { requestRevision: 1, status: "ready" as const, snapshot: snapshotValue };
}

function installSnapshot(snapshotValue: RepositoryEnvironmentSnapshot): void {
  const target = useRepositoryEnvironmentStore.getState().beginInspection(snapshotValue.workspaceId);
  useRepositoryEnvironmentStore.getState().finishInspection(target, snapshotValue);
}

function snapshot(
  overrides: Partial<RepositoryEnvironmentSnapshot> = {}
): RepositoryEnvironmentSnapshot {
  return {
    workspaceId: "workspace-a",
    status: "ready",
    revision: 1,
    observedAt: 10,
    stale: false,
    repository: {
      repositoryGroupId: `repo_${"a".repeat(32)}`,
      assurance: "filesystem",
      currentWorktreeId: "worktree-current"
    },
    worktrees: [{
      worktreeId: "worktree-current",
      workspaceId: "workspace-a",
      kind: "primary",
      status: "ready",
      branchName: "main",
      headSha: "b".repeat(40),
      detached: false,
      locked: false
    }],
    ...overrides
  };
}
