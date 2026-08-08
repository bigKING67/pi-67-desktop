import { describe, expect, it } from "vitest";
import {
  advanceEnvironmentCreation,
  canAdvanceEnvironmentCreation,
  isEnvironmentMutationRecoveryRecord,
  isWorkspaceEnvironmentBinding,
  type EnvironmentMutationRecoveryRecord
} from "./worktree-environment.js";

const reservedRecord = (): EnvironmentMutationRecoveryRecord => ({
  kind: "worktree-creation",
  creationId: "creation-1",
  requestId: "request-1",
  requestFingerprint: "1".repeat(64),
  sourceWorkspaceId: "workspace-source",
  repositoryGroupId: `repo_${"2".repeat(32)}`,
  worktreeToken: "a1b2c3d4e5f6g7h8",
  branchName: "pi67/task-a1b2c3d4e5f6g7h8",
  headSha: "3".repeat(40),
  state: "reserved",
  createdAt: 10,
  updatedAt: 10
});

describe("Worktree environment domain", () => {
  it("accepts only internally consistent Workspace environment bindings", () => {
    expect(isWorkspaceEnvironmentBinding({
      workspaceId: "workspace-1",
      kind: "plain",
      ownership: "user"
    })).toBe(true);
    expect(isWorkspaceEnvironmentBinding({
      workspaceId: "workspace-1",
      kind: "repository-primary",
      ownership: "user",
      repositoryGroupId: `repo_${"a".repeat(32)}`
    })).toBe(true);
    expect(isWorkspaceEnvironmentBinding({
      workspaceId: "workspace-1",
      kind: "repository-worktree",
      ownership: "app",
      repositoryGroupId: `repo_${"a".repeat(32)}`,
      creationId: "creation-1"
    })).toBe(true);
    expect(isWorkspaceEnvironmentBinding({
      workspaceId: "workspace-1",
      kind: "plain",
      ownership: "app"
    })).toBe(false);
    expect(isWorkspaceEnvironmentBinding({
      workspaceId: "workspace-1",
      kind: "repository-primary",
      ownership: "user"
    })).toBe(false);
  });

  it("advances creation only through declared durable stages", () => {
    expect(canAdvanceEnvironmentCreation("reserved", "git-materializing")).toBe(true);
    expect(canAdvanceEnvironmentCreation("reserved", "workspace-registered")).toBe(false);
    const materializing = advanceEnvironmentCreation(reservedRecord(), "git-materializing", 11);
    const materialized = advanceEnvironmentCreation(materializing, "git-materialized", 12);
    const registered = advanceEnvironmentCreation(materialized, "workspace-registered", 13, {
      workspaceId: "workspace-created"
    });
    expect(registered).toMatchObject({
      state: "workspace-registered",
      workspaceId: "workspace-created",
      updatedAt: 13
    });
    expect(() => advanceEnvironmentCreation(registered, "committed", 14)).toThrow(
      "cannot advance from workspace-registered to committed"
    );
  });

  it("requires exact opaque branch/path identity and state-dependent bindings", () => {
    expect(isEnvironmentMutationRecoveryRecord(reservedRecord())).toBe(true);
    expect(isEnvironmentMutationRecoveryRecord({
      ...reservedRecord(),
      branchName: "pi67/task-human-title"
    })).toBe(false);
    expect(isEnvironmentMutationRecoveryRecord({
      ...reservedRecord(),
      state: "workspace-registered"
    })).toBe(false);
    expect(isEnvironmentMutationRecoveryRecord({
      ...reservedRecord(),
      state: "session-bound",
      workspaceId: "workspace-created",
      sessionFileIdentity: "session-file-1"
    })).toBe(true);
  });

  it("persists pre-Host rollback authority only across rollback recovery states", () => {
    const materializing = advanceEnvironmentCreation(reservedRecord(), "git-materializing", 11);
    const materialized = advanceEnvironmentCreation(materializing, "git-materialized", 12);
    const registered = advanceEnvironmentCreation(materialized, "workspace-registered", 13, {
      workspaceId: "workspace-created"
    });
    const pending = advanceEnvironmentCreation(registered, "rollback-pending", 14, {
      rollbackSafety: "pre-host-confirmed"
    });
    const rolledBack = advanceEnvironmentCreation(pending, "rolled-back", 15, {
      workspaceId: undefined
    });

    expect(isEnvironmentMutationRecoveryRecord(pending)).toBe(true);
    expect(rolledBack).toMatchObject({
      state: "rolled-back",
      rollbackSafety: "pre-host-confirmed",
      workspaceId: undefined
    });
    expect(isEnvironmentMutationRecoveryRecord(rolledBack)).toBe(true);
    expect(isEnvironmentMutationRecoveryRecord({
      ...registered,
      rollbackSafety: "pre-host-confirmed"
    })).toBe(false);
  });
});
