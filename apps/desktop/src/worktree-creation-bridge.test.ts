import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.ipcHandle }
}));

import { isWorktreeCreationResult, isWorktreeCreationRollbackResult } from "@pi67/protocol";
import {
  registerWorktreeCreationBridge,
  type WorktreeCreationBridge
} from "./worktree-creation-bridge.js";

describe("Worktree creation bridge", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects unvalidated path, branch, force, and Git arguments before calling the service", async () => {
    const create = vi.fn();
    registerWorktreeCreationBridge(bridge({ create }));

    for (const extra of [
      { cwd: "C:\\private\\repository" },
      { targetPath: "C:\\private\\worktree" },
      { branchName: "feature/user" },
      { force: true },
      { gitArgs: ["worktree", "add"] }
    ]) {
      await expect(invoke({
        requestId: "request-1",
        creationId: "creation-1",
        sourceWorkspaceId: "workspace-source",
        ...extra
      })).resolves.toEqual({
        status: "rejected",
        error: { stage: "request", code: "invalid-request", recoverable: false }
      });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("forwards only the parsed opaque intent and validates the public response", async () => {
    const result = createdResult();
    const create = vi.fn(async () => result);
    registerWorktreeCreationBridge(bridge({ create }));

    await expect(invoke({
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    })).resolves.toEqual(result);
    expect(create).toHaveBeenCalledWith({
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    });
  });

  it("projects bounded progress and cancellation without accepting force or path fields", async () => {
    const activity = vi.fn(() => ({
      status: "active" as const,
      activity: {
        creationId: "creation-1",
        stage: "checkout" as const,
        startedAt: 10,
        updatedAt: 10,
        budgetMs: 300_000,
        cancellable: true as const
      }
    }));
    const cancel = vi.fn(() => ({ status: "cancel-requested" as const }));
    registerWorktreeCreationBridge(bridge({ activity, cancel }));

    await expect(invokeChannel("pi67:worktree-environment-activity", {
      creationId: "creation-1"
    })).resolves.toMatchObject({ status: "active", activity: { stage: "checkout", budgetMs: 300_000 } });
    await expect(invokeChannel("pi67:worktree-environment-cancel", {
      creationId: "creation-1"
    })).resolves.toEqual({ status: "cancel-requested" });
    expect(activity).toHaveBeenCalledWith({ creationId: "creation-1" });
    expect(cancel).toHaveBeenCalledWith({ creationId: "creation-1" });

    await expect(invokeChannel("pi67:worktree-environment-activity", {
      creationId: "creation-1",
      targetPath: "/private/worktree"
    })).resolves.toEqual({ status: "inactive" });
    await expect(invokeChannel("pi67:worktree-environment-cancel", {
      creationId: "creation-1",
      force: true
    })).resolves.toEqual({ status: "inactive" });
    expect(activity).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();

    activity.mockReturnValue({
      status: "active",
      activity: {
        creationId: "creation-1",
        stage: "checkout",
        startedAt: 10,
        updatedAt: 10,
        budgetMs: 300_000,
        cancellable: true,
        stdout: "private"
      }
    } as never);
    await expect(invokeChannel("pi67:worktree-environment-activity", {
      creationId: "creation-1"
    })).resolves.toEqual({ status: "inactive" });
  });

  it("collapses thrown or invalid internal results to a typed failure without leaking details", async () => {
    for (const create of [
      vi.fn(async () => ({ status: "created", stdout: "private" })),
      vi.fn(async () => { throw new Error("private Git executable and arguments"); })
    ]) {
      mocks.handlers.clear();
      registerWorktreeCreationBridge(bridge({
        create: create as unknown as WorktreeCreationBridge["create"]
      }));
      const result = await invoke({
        requestId: "request-1",
        creationId: "creation-1",
        sourceWorkspaceId: "workspace-source"
      });
      expect(result).toEqual({
        status: "rejected",
        error: { stage: "state", code: "internal", recoverable: true }
      });
      expect(isWorktreeCreationResult(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });

  it("validates lifecycle binding intent and collapses invalid service receipts", async () => {
    const advance = vi.fn(async () => ({
      status: "advanced" as const,
      receipt: {
        creationId: "creation-1",
        state: "session-bound" as const,
        workspaceId: "workspace-created",
        sessionFileIdentity: "session-file-1"
      }
    }));
    registerWorktreeCreationBridge(bridge({ advance }));

    await expect(invokeChannel("pi67:worktree-environment-advance", {
      creationId: "creation-1",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    })).resolves.toMatchObject({ status: "advanced" });
    expect(advance).toHaveBeenCalledWith({
      creationId: "creation-1",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    });

    await expect(invokeChannel("pi67:worktree-environment-advance", {
      creationId: "creation-1",
      targetState: "host-registered",
      sessionFileIdentity: "too-early"
    })).resolves.toEqual({
      status: "rejected",
      error: { stage: "request", code: "invalid-request", recoverable: false }
    });
    expect(advance).toHaveBeenCalledOnce();

    advance.mockImplementation(async () => ({
      status: "advanced",
      receipt: {
        creationId: "creation-1",
        state: "session-bound",
        workspaceId: "workspace-created"
      }
    }) as never);
    await expect(invokeChannel("pi67:worktree-environment-advance", {
      creationId: "creation-1",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    })).resolves.toEqual({
      status: "rejected",
      error: { stage: "state", code: "internal", recoverable: true }
    });
  });

  it("forwards only opaque rollback identity and validates the bounded rollback receipt", async () => {
    const rollback = vi.fn(async () => ({
      status: "rolled-back" as const,
      receipt: {
        requestId: "request-1",
        creationId: "creation-1",
        sourceWorkspaceId: "workspace-source",
        state: "rolled-back" as const
      }
    }));
    registerWorktreeCreationBridge(bridge({ rollback }));

    const request = {
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    };
    const result = await invokeChannel("pi67:worktree-environment-rollback", request);
    expect(isWorktreeCreationRollbackResult(result)).toBe(true);
    expect(rollback).toHaveBeenCalledWith(request);

    await expect(invokeChannel("pi67:worktree-environment-rollback", {
      ...request,
      force: true
    })).resolves.toEqual({
      status: "rejected",
      error: { stage: "request", code: "invalid-request", recoverable: false }
    });
    expect(rollback).toHaveBeenCalledOnce();

    rollback.mockImplementation(async () => ({
      status: "rolled-back",
      receipt: { ...request, state: "rolled-back", stdout: "private" }
    }) as never);
    const invalid = await invokeChannel("pi67:worktree-environment-rollback", request);
    expect(invalid).toEqual({
      status: "rejected",
      error: { stage: "state", code: "internal", recoverable: true }
    });
    expect(JSON.stringify(invalid)).not.toContain("private");
  });
});

async function invoke(value: unknown): Promise<unknown> {
  return invokeChannel("pi67:worktree-environment-create", value);
}

async function invokeChannel(channel: string, value: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing Worktree IPC handler: ${channel}`);
  return handler(undefined, value);
}

function bridge(overrides: Partial<WorktreeCreationBridge>): WorktreeCreationBridge {
  return {
    activity: vi.fn(() => ({ status: "inactive" as const })),
    cancel: vi.fn(() => ({ status: "inactive" as const })),
    create: vi.fn(async () => ({
      status: "rejected" as const,
      error: { stage: "state" as const, code: "internal" as const, recoverable: true }
    })),
    advance: vi.fn(async () => ({
      status: "rejected" as const,
      error: { stage: "state" as const, code: "internal" as const, recoverable: true }
    })),
    rollback: vi.fn(async () => ({
      status: "rejected" as const,
      error: { stage: "state" as const, code: "internal" as const, recoverable: true }
    })),
    ...overrides
  };
}

function createdResult() {
  return {
    status: "created" as const,
    receipt: {
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source",
      repositoryGroupId: `repo_${"a".repeat(32)}`,
      state: "workspace-registered" as const,
      workspace: {
        id: "workspace-created",
        displayName: "0123456789abcdef",
        identity: {
          canonicalPath: "C:\\profile\\worktrees\\0123456789abcdef",
          device: "1",
          inode: "2",
          assurance: "filesystem" as const
        },
        trust: "trusted" as const,
        trustProvenance: "indirect" as const,
        availability: "available" as const
      }
    }
  };
}
