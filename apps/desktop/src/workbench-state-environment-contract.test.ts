import { describe, expect, it } from "vitest";
import {
  parseEnvironmentMutationRecoveryRecords,
  parseWorkspaceEnvironmentBindings
} from "./workbench-state-environment-contract.js";

describe("Workbench state environment contract", () => {
  it("requires one unique environment binding for every registered Workspace", () => {
    const workspaceIds = new Set(["workspace-a", "workspace-b"]);
    expect(parseWorkspaceEnvironmentBindings([], workspaceIds, 2)).toBeUndefined();
    expect(parseWorkspaceEnvironmentBindings([
      { workspaceId: "workspace-a", kind: "plain", ownership: "user" },
      { workspaceId: "workspace-missing", kind: "plain", ownership: "user" }
    ], workspaceIds, 2)).toBeUndefined();
    expect(parseWorkspaceEnvironmentBindings([
      { workspaceId: "workspace-a", kind: "plain", ownership: "user" },
      { workspaceId: "workspace-a", kind: "plain", ownership: "user" }
    ], workspaceIds, 2)).toBeUndefined();
    expect(parseWorkspaceEnvironmentBindings([
      { workspaceId: "workspace-a", kind: "plain", ownership: "user" },
      { workspaceId: "workspace-b", kind: "plain", ownership: "user" }
    ], workspaceIds, 2)).toHaveLength(2);
  });

  it("rejects non-array and over-budget environment mutation journals", () => {
    const workspaceIds = new Set(["workspace-a"]);
    expect(parseEnvironmentMutationRecoveryRecords({}, workspaceIds, 1)).toBeUndefined();
    expect(parseEnvironmentMutationRecoveryRecords([{}, {}], workspaceIds, 1)).toBeUndefined();
    expect(parseEnvironmentMutationRecoveryRecords([], workspaceIds, 1)).toEqual([]);
  });
});
