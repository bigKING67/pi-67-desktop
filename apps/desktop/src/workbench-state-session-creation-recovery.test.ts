import { describe, expect, it } from "vitest";
import {
  finishWorkbenchRun,
  parseWorkbenchStateV5,
  type WorkbenchStateV5
} from "./workbench-state-contract.js";
import { replaceWorkbenchLayout } from "./workbench-state-mutations.js";
import { workbenchDescriptorFixture } from "./workbench-state-test-fixture.js";
import { parseAndMigrateWorkbenchStateV3 } from "./workbench-state-v3.js";

describe("Workbench Session creation recovery state", () => {
  it("accepts legacy V3 state without creation recovery records", () => {
    expect(parseAndMigrateWorkbenchStateV3({
      version: 3,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-a"],
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: { kind: "workspace", workspaceId: "workspace-a" },
      runtimeRecovery: [],
      settings: { section: "general", scope: "global" },
      cleanExit: true
    })?.sessionCreationRecovery).toEqual([]);
  });

  it("preserves an unconfirmed creation placeholder across a clean shutdown", () => {
    const state: WorkbenchStateV5 = {
      version: 5,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-a"],
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-a",
          draftId: "task-creation"
        }
      },
      runtimeRecovery: [],
      sessionCreationRecovery: [{
        taskId: "task-creation",
        workspaceId: "workspace-a",
        creationId: "session-creation-persisted",
        taskGeneration: 3
      }],
      workspaceEnvironments: [{ workspaceId: "workspace-a", kind: "plain", ownership: "user" }],
      environmentMutations: [],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    };

    expect(finishWorkbenchRun(state)).toMatchObject({
      cleanExit: true,
      runtimeRecovery: [],
      sessionCreationRecovery: state.sessionCreationRecovery,
      selectedSurface: state.selectedSurface
    });
  });

  it("rejects duplicate creation identity or provisional selection without recovery authority", () => {
    const base = {
      version: 5,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-a"],
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      runtimeRecovery: [],
      workspaceEnvironments: [{ workspaceId: "workspace-a", kind: "plain", ownership: "user" }],
      environmentMutations: [],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    } as const;
    const record = {
      taskId: "task-creation",
      workspaceId: "workspace-a",
      creationId: "session-creation-duplicate",
      taskGeneration: 1
    };

    expect(parseWorkbenchStateV5({
      ...base,
      sessionCreationRecovery: [record, { ...record, taskId: "task-other" }]
    })).toBeUndefined();
    expect(parseWorkbenchStateV5({
      ...base,
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-a",
          draftId: "task-creation"
        }
      },
      sessionCreationRecovery: []
    })).toBeUndefined();
  });

  it("rejects a Renderer layout update that omits creation recovery state", () => {
    const state = parseWorkbenchStateV5({
      version: 5,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-a"],
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: { kind: "workspace", workspaceId: "workspace-a" },
      runtimeRecovery: [],
      sessionCreationRecovery: [],
      workspaceEnvironments: [{ workspaceId: "workspace-a", kind: "plain", ownership: "user" }],
      environmentMutations: [],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    });
    expect(state).toBeDefined();

    expect(() => replaceWorkbenchLayout(state!, {
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: { kind: "workspace", workspaceId: "workspace-a" },
      runtimeRecovery: [],
      settings: { section: "general", scope: "global" }
    })).toThrow("Workbench layout is invalid.");
  });
});

function workspace() {
  return workbenchDescriptorFixture("workspace-a", "/work/a");
}
