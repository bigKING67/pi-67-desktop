import type { EnvironmentMutationRecoveryRecord, WorktreeCreationRequest } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { createEmptyWorkbenchState, type WorkbenchStateV5 } from "./workbench-state.js";
import { workbenchDescriptorFixture } from "./workbench-state-test-fixture.js";
import { GitInspectionError } from "./worktree-git-runner.js";
import {
  creationRequestFingerprint,
  existingCreationResult,
  isProgressState,
  isTerminalCreationState,
  mapGitPreflightError,
  matchingRollbackRecord,
  monotonicNow,
  pathsEqual,
  progressReceipt,
  rejected,
  rolledBack,
  serviceError
} from "./worktree-creation-service-support.js";

const request: WorktreeCreationRequest = {
  requestId: "request-support",
  creationId: "creation-support",
  sourceWorkspaceId: "workspace-source"
};

describe("Worktree creation service support", () => {
  it("maps Git preflight failures without leaking process details", () => {
    expect(mapGitPreflightError(new GitInspectionError("head", "toolchain-unavailable")).view).toEqual({
      stage: "preflight",
      code: "toolchain-unavailable",
      recoverable: true
    });
    expect(mapGitPreflightError(new GitInspectionError("head", "timeout")).view).toEqual({
      stage: "preflight",
      code: "repository-not-ready",
      recoverable: true
    });
    expect(mapGitPreflightError(new Error("private detail")).message).toBe(
      "Worktree creation failed (preflight/repository-not-ready)."
    );
  });

  it("replays only an exact durable creation receipt", () => {
    const fingerprint = creationRequestFingerprint(request);
    const durable = recoveryRecord({ requestFingerprint: fingerprint });
    const valid = recoveryState(durable, true);
    const materialized: EnvironmentMutationRecoveryRecord = { ...durable, state: "git-materialized" };
    delete materialized.workspaceId;

    expect(existingCreationResult(valid, request, fingerprint)).toMatchObject({
      status: "created",
      receipt: { creationId: request.creationId, workspace: { id: "workspace-created" } }
    });
    expect(existingCreationResult(valid, request, "b".repeat(64))).toEqual(
      rejected("request", "invalid-request", false)
    );
    expect(existingCreationResult(
      recoveryState(materialized, true),
      request,
      fingerprint
    )).toEqual(rejected("state", "recovery-required", true));
    expect(existingCreationResult(recoveryState(durable, false), request, fingerprint)).toEqual(
      rejected("state", "recovery-required", true)
    );
    expect(existingCreationResult(createEmptyWorkbenchState(), request, fingerprint)).toBeUndefined();
  });

  it("matches rollback identity across both lookup keys but requires the full caller identity", () => {
    const durable = recoveryRecord();
    const state = recoveryState(durable, true);
    expect(matchingRollbackRecord(state, request)).toEqual(durable);
    expect(matchingRollbackRecord(state, { ...request, creationId: "creation-other" })).toBeUndefined();
    expect(matchingRollbackRecord(state, { ...request, requestId: "request-other" })).toBeUndefined();
    expect(rolledBack(durable)).toEqual({
      status: "rolled-back",
      receipt: { ...request, state: "rolled-back" }
    });
  });

  it("enforces platform path equality and progress receipt invariants", () => {
    const durable = recoveryRecord();
    const missingWorkspace: EnvironmentMutationRecoveryRecord = { ...durable };
    delete missingWorkspace.workspaceId;
    expect(pathsEqual("C:\\Repo", "c:\\repo", "win32")).toBe(true);
    expect(pathsEqual("/Repo", "/repo", "darwin")).toBe(false);
    expect(monotonicNow(10, 20)).toBe(20);
    expect(isTerminalCreationState("committed")).toBe(true);
    expect(isTerminalCreationState("host-registering")).toBe(false);
    expect(isProgressState("workspace-registered")).toBe(true);
    expect(isProgressState("rollback-pending")).toBe(false);
    expect(progressReceipt(durable)).toEqual({
      creationId: durable.creationId,
      state: "workspace-registered",
      workspaceId: "workspace-created"
    });
    expect(() => progressReceipt(missingWorkspace)).toThrow("recovery-required");
    expect(() => progressReceipt({
      ...durable,
      state: "session-bound"
    })).toThrow("recovery-required");
    expect(progressReceipt({
      ...durable,
      state: "committed",
      sessionFileIdentity: "session-file-1"
    })).toMatchObject({ state: "committed", sessionFileIdentity: "session-file-1" });
    expect(serviceError("state", "internal", true).view).toEqual({
      stage: "state",
      code: "internal",
      recoverable: true
    });
  });
});

function recoveryRecord(
  overrides: Partial<EnvironmentMutationRecoveryRecord> = {}
): EnvironmentMutationRecoveryRecord {
  return {
    kind: "worktree-creation",
    requestId: request.requestId,
    creationId: request.creationId,
    requestFingerprint: creationRequestFingerprint(request),
    sourceWorkspaceId: request.sourceWorkspaceId,
    repositoryGroupId: "a".repeat(64),
    worktreeToken: "a1b2c3d4e5f6g7h8",
    branchName: "pi67/task-a1b2c3d4e5f6g7h8",
    headSha: "b".repeat(40),
    workspaceId: "workspace-created",
    state: "workspace-registered",
    createdAt: 10,
    updatedAt: 20,
    ...overrides
  };
}

function recoveryState(
  record: EnvironmentMutationRecoveryRecord,
  includeWorkspace: boolean
): WorkbenchStateV5 {
  const workspace = workbenchDescriptorFixture("workspace-created", "/workspace-created");
  return {
    ...createEmptyWorkbenchState(),
    workspaces: includeWorkspace ? [workspace] : [],
    environmentMutations: [record]
  };
}
