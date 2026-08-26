import { describe, expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import {
  isWorktreeCreationAdvanceResult,
  isWorktreeCreationActivityResult,
  isWorktreeCreationCancelResult,
  isWorktreeCreationResult,
  isWorktreeCreationRollbackResult,
  parseWorktreeCreationAdvanceRequest,
  parseWorktreeCreationActivityRequest,
  parseWorktreeCreationCancelRequest,
  parseWorktreeCreationRequest,
  parseWorktreeCreationRollbackRequest
} from "./worktree-creation.js";
import {
  WorktreeCreationAdvanceResultSchema,
  WorktreeCreationActivityResultSchema,
  WorktreeCreationCancelResultSchema,
  WorktreeCreationResultSchema,
  WorktreeCreationRollbackResultSchema
} from "./worktree-creation-schema.js";

const createdResult = () => ({
  status: "created" as const,
  receipt: {
    requestId: "request-1",
    creationId: "creation-1",
    sourceWorkspaceId: "workspace-source",
    repositoryGroupId: `repo_${"a".repeat(32)}`,
    state: "workspace-registered" as const,
    workspace: {
      id: "workspace-created",
      displayName: "a1b2c3d4e5f6g7h8",
      identity: {
        canonicalPath: "/profile/worktrees/repo/a1b2c3d4e5f6g7h8",
        device: "1",
        inode: "2",
        birthtimeNs: "3",
        assurance: "filesystem" as const
      },
      lastVerifiedAt: 10,
      trust: "trusted" as const,
      trustProvenance: "indirect" as const,
      availability: "available" as const
    }
  }
});

function withCanonicalPath(canonicalPath: string) {
  return {
    ...createdResult(),
    receipt: {
      ...createdResult().receipt,
      workspace: {
        ...createdResult().receipt.workspace,
        identity: {
          ...createdResult().receipt.workspace.identity,
          canonicalPath
        }
      }
    }
  };
}

describe("Worktree creation protocol", () => {
  it("accepts only opaque caller-stable intent without path, branch, force, or Git arguments", () => {
    expect(parseWorktreeCreationRequest({
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    })).toEqual({
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    });
    for (const extra of [
      { cwd: "/repo" },
      { targetPath: "/tmp/worktree" },
      { branchName: "feature/user" },
      { force: true },
      { gitArgs: ["worktree", "add"] }
    ]) {
      expect(parseWorktreeCreationRequest({
        requestId: "request-1",
        creationId: "creation-1",
        sourceWorkspaceId: "workspace-source",
        ...extra
      })).toBeUndefined();
    }
  });

  it("keeps progress and cancellation bounded to an opaque creation identity", () => {
    expect(parseWorktreeCreationActivityRequest({ creationId: "creation-1" })).toEqual({
      creationId: "creation-1"
    });
    expect(parseWorktreeCreationCancelRequest({ creationId: "creation-1" })).toEqual({
      creationId: "creation-1"
    });
    expect(parseWorktreeCreationActivityRequest({ creationId: "creation-1", targetPath: "/private" }))
      .toBeUndefined();
    expect(parseWorktreeCreationCancelRequest({ creationId: "creation-1", force: true })).toBeUndefined();

    const activityCases = [
      {
        status: "active",
        activity: {
          creationId: "creation-1",
          stage: "checkout",
          startedAt: 10,
          updatedAt: 10,
          budgetMs: 300_000,
          cancellable: true
        }
      },
      { status: "inactive" },
      {
        status: "active",
        activity: {
          creationId: "creation-1",
          stage: "checkout",
          startedAt: 11,
          updatedAt: 10,
          budgetMs: 300_000,
          cancellable: true
        }
      },
      {
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
      }
    ];
    for (const candidate of activityCases) {
      const strict = Value.Check(WorktreeCreationActivityResultSchema, candidate);
      expect(isWorktreeCreationActivityResult(candidate)).toBe(candidate === activityCases[2] ? false : strict);
    }
    expect(isWorktreeCreationActivityResult(activityCases[0])).toBe(true);
    expect(isWorktreeCreationActivityResult(activityCases[1])).toBe(true);
    expect(isWorktreeCreationActivityResult(activityCases[2])).toBe(false);
    expect(isWorktreeCreationActivityResult(activityCases[3])).toBe(false);

    for (const candidate of [
      { status: "cancel-requested" },
      { status: "inactive" },
      { status: "cancel-requested", force: true }
    ]) {
      expect(isWorktreeCreationCancelResult(candidate)).toBe(
        Value.Check(WorktreeCreationCancelResultSchema, candidate)
      );
    }
  });

  it("keeps the lightweight preload validator aligned with the strict TypeBox result schema", () => {
    const cases = [
      {
        ...createdResult(),
        receipt: {
          ...createdResult().receipt,
          submodules: {
            status: "incomplete",
            total: 2,
            uninitialized: 0,
            divergent: 1,
            conflicted: 0,
            networkActionRequired: false
          }
        }
      },
      withCanonicalPath("C:\\Users\\Example User\\AppData\\Roaming\\pi67\\worktrees\\task"),
      withCanonicalPath("\\\\server\\share\\pi67\\worktrees\\task"),
      {
        ...createdResult(),
        receipt: {
          ...createdResult().receipt,
          workspace: {
            ...createdResult().receipt.workspace,
            identity: {
              canonicalPath: "C:\\pi67\\worktrees\\task",
              assurance: "path-only" as const
            }
          }
        }
      },
      { status: "rejected", error: { stage: "preflight", code: "custom-filter", recoverable: true } },
      { ...createdResult(), stdout: "private" },
      { ...createdResult(), stderr: "private" },
      {
        ...createdResult(),
        receipt: { ...createdResult().receipt, privateGitExecutable: "/private/git" }
      },
      {
        ...createdResult(),
        receipt: { ...createdResult().receipt, gitArgs: ["worktree", "add"] }
      },
      {
        ...withCanonicalPath("relative/worktree")
      },
      {
        ...withCanonicalPath("C:\\pi67\\worktrees\\task\0escape")
      },
      {
        ...createdResult(),
        receipt: {
          ...createdResult().receipt,
          workspace: {
            ...createdResult().receipt.workspace,
            identity: {
              canonicalPath: "C:\\pi67\\worktrees\\task",
              device: "1",
              assurance: "filesystem" as const
            }
          }
        }
      }
    ];
    for (const candidate of cases) {
      expect(isWorktreeCreationResult(candidate)).toBe(Value.Check(WorktreeCreationResultSchema, candidate));
    }
    expect(isWorktreeCreationResult(cases[0])).toBe(true);
    expect(isWorktreeCreationResult(cases[1])).toBe(true);
    expect(isWorktreeCreationResult(cases[2])).toBe(true);
    expect(isWorktreeCreationResult(cases[3])).toBe(true);
    expect(isWorktreeCreationResult(cases[4])).toBe(true);
    for (const candidate of cases.slice(5)) {
      expect(isWorktreeCreationResult(candidate)).toBe(false);
    }
  });

  it("allows only one-step lifecycle intent and requires exact Session identity at binding", () => {
    expect(parseWorktreeCreationAdvanceRequest({
      creationId: "creation-1",
      targetState: "host-registering"
    })).toEqual({ creationId: "creation-1", targetState: "host-registering" });
    expect(parseWorktreeCreationAdvanceRequest({
      creationId: "creation-1",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    })).toEqual({
      creationId: "creation-1",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    });
    expect(parseWorktreeCreationAdvanceRequest({
      creationId: "creation-1",
      targetState: "session-bound"
    })).toBeUndefined();
    expect(parseWorktreeCreationAdvanceRequest({
      creationId: "creation-1",
      targetState: "host-registered",
      sessionFileIdentity: "not-allowed-yet"
    })).toBeUndefined();
    expect(parseWorktreeCreationAdvanceRequest({
      creationId: "creation-1",
      targetState: "rolled-back"
    })).toBeUndefined();
  });

  it("keeps advance receipts aligned without admitting missing or leaked Session identity", () => {
    const cases = [
      {
        status: "advanced",
        receipt: { creationId: "creation-1", state: "host-registered", workspaceId: "workspace-created" }
      },
      {
        status: "advanced",
        receipt: {
          creationId: "creation-1",
          state: "session-bound",
          workspaceId: "workspace-created",
          sessionFileIdentity: "session-file-1"
        }
      },
      {
        status: "advanced",
        receipt: { creationId: "creation-1", state: "session-bound", workspaceId: "workspace-created" }
      },
      {
        status: "advanced",
        receipt: {
          creationId: "creation-1",
          state: "host-registered",
          workspaceId: "workspace-created",
          sessionFileIdentity: "too-early"
        }
      },
      {
        status: "advanced",
        receipt: {
          creationId: "creation-1",
          state: "committed",
          workspaceId: "workspace-created",
          sessionFileIdentity: "session-file-1",
          stdout: "private"
        }
      }
    ];
    for (const candidate of cases) {
      expect(isWorktreeCreationAdvanceResult(candidate)).toBe(
        Value.Check(WorktreeCreationAdvanceResultSchema, candidate)
      );
    }
    expect(isWorktreeCreationAdvanceResult(cases[0])).toBe(true);
    expect(isWorktreeCreationAdvanceResult(cases[1])).toBe(true);
    for (const candidate of cases.slice(2)) {
      expect(isWorktreeCreationAdvanceResult(candidate)).toBe(false);
    }
  });

  it("keeps rollback intent opaque and rollback receipts aligned with the strict schema", () => {
    const request = {
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: "workspace-source"
    };
    expect(parseWorktreeCreationRollbackRequest(request)).toEqual(request);
    expect(parseWorktreeCreationRollbackRequest({ ...request, force: true })).toBeUndefined();
    expect(parseWorktreeCreationRollbackRequest({ ...request, targetPath: "/private/worktree" })).toBeUndefined();

    const cases = [
      {
        status: "rolled-back",
        receipt: { ...request, state: "rolled-back" }
      },
      {
        status: "rejected",
        error: { stage: "rollback", code: "rollback-protected", recoverable: false }
      },
      {
        status: "rolled-back",
        receipt: { ...request, state: "rolled-back", stdout: "private" }
      },
      {
        status: "rolled-back",
        receipt: { ...request, state: "committed" }
      }
    ];
    for (const candidate of cases) {
      expect(isWorktreeCreationRollbackResult(candidate)).toBe(
        Value.Check(WorktreeCreationRollbackResultSchema, candidate)
      );
    }
    expect(isWorktreeCreationRollbackResult(cases[0])).toBe(true);
    expect(isWorktreeCreationRollbackResult(cases[1])).toBe(true);
    expect(isWorktreeCreationRollbackResult(cases[2])).toBe(false);
    expect(isWorktreeCreationRollbackResult(cases[3])).toBe(false);
  });
});
