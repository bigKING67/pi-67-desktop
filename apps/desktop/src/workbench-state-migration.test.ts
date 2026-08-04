import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEGACY_WORKBENCH_STATE_FILENAME,
  LEGACY_WORKBENCH_STATE_V2_FILENAME,
  WORKBENCH_STATE_DIRECTORY,
  WORKBENCH_STATE_FILENAME
} from "./workbench-state.js";
import {
  cleanupWorkbenchStateTestRoots,
  legacyWorkbenchTask,
  temporaryWorkbenchStateRoot,
  workbenchDescriptorFixture,
  workbenchStateTestStore
} from "./workbench-state-test-fixture.js";

afterEach(cleanupWorkbenchStateTestRoots);

describe("Workbench state migration", () => {
  it("migrates V2 layout metadata while clearing every legacy recovery shell", async () => {
    const userData = await temporaryWorkbenchStateRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = workbenchDescriptorFixture("workspace-1", "/workspace/first", "35");
    const provisional = {
      kind: "provisional" as const,
      workspaceId: workspace.id,
      draftId: "pending-task"
    };
    await mkdir(directory);
    await writeFile(join(directory, LEGACY_WORKBENCH_STATE_V2_FILENAME), JSON.stringify({
      version: 2,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: { kind: "conversation", conversation: provisional },
      runtimeRecovery: [{
        taskId: "pending-task",
        conversation: provisional,
        sessionId: "pending-session",
        taskGeneration: 1,
        lastKnownLifecycle: "running"
      }],
      settings: { section: "extensions", scope: "project", workspaceId: workspace.id },
      cleanExit: false
    }), { mode: 0o600 });

    const loaded = await workbenchStateTestStore(userData).load();

    expect(loaded.recovery).toEqual({ kind: "migrated-v2" });
    expect(loaded.state).toMatchObject({
      version: 3,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: { kind: "workspace", workspaceId: workspace.id },
      runtimeRecovery: [],
      settings: { section: "extensions", scope: "project", workspaceId: workspace.id }
    });
    expect(await readdir(directory)).toEqual([
      LEGACY_WORKBENCH_STATE_V2_FILENAME,
      WORKBENCH_STATE_FILENAME
    ]);
  });

  it.each([
    ["resources", "skills"],
    ["prompts-rules", "prompts"],
    ["packages", "extensions"]
  ])("normalizes the former V2 %s section to %s", async (legacySection, expectedSection) => {
    const userData = await temporaryWorkbenchStateRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = workbenchDescriptorFixture("workspace-1", "/workspace/first", "36");
    await mkdir(directory);
    await writeFile(join(directory, LEGACY_WORKBENCH_STATE_V2_FILENAME), JSON.stringify({
      version: 2,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: legacySection === "packages"
        ? { kind: "settings" }
        : { kind: "workspace", workspaceId: workspace.id },
      runtimeRecovery: [],
      settings: { section: legacySection, scope: "project", workspaceId: workspace.id },
      cleanExit: true
    }), { mode: 0o600 });

    const loaded = await workbenchStateTestStore(userData).load();
    expect(loaded.recovery).toEqual({ kind: "migrated-v2" });
    expect(loaded.state.settings).toEqual({
      section: expectedSection,
      scope: "project",
      workspaceId: workspace.id
    });
  });

  it("migrates V1 registrations and settings while dropping stale recovery shells", async () => {
    const userData = await temporaryWorkbenchStateRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = workbenchDescriptorFixture("workspace-1", "/workspace/first", "51");
    await mkdir(directory);
    await writeFile(join(directory, LEGACY_WORKBENCH_STATE_FILENAME), JSON.stringify({
      version: 1,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      currentWorkspaceId: workspace.id,
      tasks: [
        legacyWorkbenchTask("running-task", workspace.id, "running", "/sessions/running.jsonl"),
        legacyWorkbenchTask("idle-task", workspace.id, "idle", "/sessions/idle.jsonl")
      ],
      taskOrder: ["running-task", "idle-task"],
      selectedSurface: { kind: "task", taskId: "idle-task" },
      settings: { open: false, section: "extensions", scope: "project", workspaceId: workspace.id },
      cleanExit: false
    }), { mode: 0o600 });

    const loaded = await workbenchStateTestStore(userData).load();

    expect(loaded.recovery).toEqual({ kind: "migrated-v1" });
    expect(loaded.state).toMatchObject({
      version: 3,
      selectedSurface: { kind: "workspace", workspaceId: workspace.id },
      runtimeRecovery: [],
      settings: { section: "extensions", scope: "project", workspaceId: workspace.id }
    });
    expect(await readdir(directory)).toEqual([LEGACY_WORKBENCH_STATE_FILENAME, WORKBENCH_STATE_FILENAME]);
  });
});
