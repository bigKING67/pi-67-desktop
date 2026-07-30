import { lstatSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addOrRefreshWorkspace,
  beginWorkbenchRun,
  createEmptyWorkbenchState,
  finishWorkbenchRun,
  LEGACY_WORKBENCH_STATE_FILENAME,
  MAX_WORKBENCH_STATE_BYTES,
  removeWorkspaceRegistration,
  repairWorkspaceRegistration,
  reorderWorkspaceRegistrations,
  replaceWorkspaceRegistrations,
  replaceWorkbenchLayout,
  UnsupportedWorkbenchStateVersionError,
  WORKBENCH_STATE_DIRECTORY,
  WORKBENCH_STATE_FILENAME,
  WorkbenchStateStore,
  type WorkbenchStateV2
} from "./workbench-state.js";
import type { NativeWorkspaceDescriptor } from "./workspace-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("WorkbenchStateV2 persistence", () => {
  it("writes the canonical V2 state atomically with POSIX-private modes", async () => {
    const userData = await temporaryRoot();
    const store = testStore(userData);
    const workspace = descriptorFixture("workspace-1", join(userData, "workspace-1"));

    const saved = await store.update((state) => addOrRefreshWorkspace(state, workspace).state);
    const serialized = await readFile(store.requestedStatePath, "utf8");
    const directoryEntries = await readdir(join(userData, WORKBENCH_STATE_DIRECTORY));

    expect(saved).toMatchObject({ version: 2, expandedWorkspaceIds: [workspace.id], runtimeRecovery: [] });
    expect(JSON.parse(serialized)).toEqual(saved);
    expect(directoryEntries).toEqual([WORKBENCH_STATE_FILENAME]);
    if (process.platform !== "win32") {
      expect(lstatSync(join(userData, WORKBENCH_STATE_DIRECTORY)).mode & 0o777).toBe(0o700);
      expect(lstatSync(store.requestedStatePath).mode & 0o777).toBe(0o600);
    }
  });

  it("serializes concurrent mutations without losing a workspace", async () => {
    const userData = await temporaryRoot();
    const store = testStore(userData);
    const first = descriptorFixture("workspace-1", join(userData, "workspace-1"), "11");
    const second = descriptorFixture("workspace-2", join(userData, "workspace-2"), "12");

    await Promise.all([
      store.update((state) => addOrRefreshWorkspace(state, first).state),
      store.update((state) => addOrRefreshWorkspace(state, second).state)
    ]);

    await expect(store.load()).resolves.toMatchObject({
      state: { workspaces: [{ id: "workspace-1" }, { id: "workspace-2" }] }
    });
  });

  it("quarantines malformed and oversized V2 state before resetting", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    await mkdir(directory);
    await writeFile(statePath, "{not-json", { mode: 0o600 });

    const malformed = await testStore(userData).load();

    expect(malformed.state).toEqual(createEmptyWorkbenchState());
    expect(malformed.recovery).toEqual({
      kind: "corrupt-reset",
      quarantinedFileName: "state-v2.corrupt-1700000000000-token.json"
    });
    expect(await readdir(directory)).toEqual(["state-v2.corrupt-1700000000000-token.json"]);

    await writeFile(statePath, "x".repeat(MAX_WORKBENCH_STATE_BYTES + 1), { mode: 0o600 });
    await expect(testStore(userData).load()).resolves.toMatchObject({ recovery: { kind: "corrupt-reset" } });
  });

  it("fails closed on a future version without quarantining or overwriting it", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    const future = '{"version":3,"future":true}\n';
    await mkdir(directory);
    await writeFile(statePath, future, { mode: 0o600 });
    const store = testStore(userData);

    await expect(store.load()).rejects.toBeInstanceOf(UnsupportedWorkbenchStateVersionError);
    await expect(store.update((state) => state)).rejects.toBeInstanceOf(UnsupportedWorkbenchStateVersionError);
    expect(await readFile(statePath, "utf8")).toBe(future);
  });

  it("rejects prompt, draft content, and credentials at the persistence boundary", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    const state = createEmptyWorkbenchState() as WorkbenchStateV2 & { prompt?: string; draft?: string; credential?: string };
    state.prompt = "do not persist";
    state.draft = "do not persist";
    state.credential = "do not persist";
    await mkdir(directory);
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

    await expect(testStore(userData).load()).resolves.toMatchObject({
      state: createEmptyWorkbenchState(),
      recovery: { kind: "corrupt-reset" }
    });
  });

  it("deduplicates, reorders, repairs, refreshes, and removes registrations without project deletion", () => {
    const first = descriptorFixture("stable-id", "/workspace/first", "22");
    const duplicate = { ...first, id: "replacement-id", displayName: "renamed" };
    const second = descriptorFixture("workspace-2", "/workspace/second", "23");
    let state = addOrRefreshWorkspace(createEmptyWorkbenchState(), first).state;

    const refreshed = addOrRefreshWorkspace(state, duplicate);
    expect(refreshed.workspace).toMatchObject({ id: "stable-id", displayName: "renamed" });
    state = addOrRefreshWorkspace(refreshed.state, second).state;
    state = reorderWorkspaceRegistrations(state, ["workspace-2", "stable-id"]);
    expect(state.workspaceOrder).toEqual(["workspace-2", "stable-id"]);

    const repaired = repairWorkspaceRegistration(state, "stable-id", descriptorFixture("picker", "/relocated", "24"));
    expect(repaired.workspace).toMatchObject({ id: "stable-id", identity: { canonicalPath: "/relocated" } });
    expect(() => repairWorkspaceRegistration(repaired.state, "stable-id", second)).toThrow(/already registered/u);
    const missing = { ...repaired.workspace, availability: "missing" as const };
    state = replaceWorkspaceRegistrations(repaired.state, [missing, second]);
    expect(state.workspaces[0]?.availability).toBe("missing");

    state = removeWorkspaceRegistration(state, "workspace-2");
    expect(state.workspaceOrder).toEqual(["stable-id"]);
    expect(state.currentWorkspaceId).toBe("stable-id");
  });

  it("repairs workspace-scoped pointers when the current registration is removed", () => {
    const first = descriptorFixture("workspace-1", "/workspace/first", "25");
    const second = descriptorFixture("workspace-2", "/workspace/second", "26");
    let state = addOrRefreshWorkspace(createEmptyWorkbenchState(), first).state;
    state = addOrRefreshWorkspace(state, second).state;
    const firstConversation = {
      kind: "session" as const,
      workspaceId: first.id,
      sessionPath: "/sessions/first.jsonl"
    };
    const secondConversation = {
      kind: "provisional" as const,
      workspaceId: second.id,
      draftId: "second-task"
    };
    state = replaceWorkbenchLayout(state, {
      currentWorkspaceId: first.id,
      expandedWorkspaceIds: [first.id, second.id],
      selectedSurface: { kind: "conversation", conversation: firstConversation },
      runtimeRecovery: [
        {
          taskId: "first-task",
          conversation: firstConversation,
          sessionId: "first-session",
          taskGeneration: 1,
          lastKnownLifecycle: "running"
        },
        {
          taskId: "second-task",
          conversation: secondConversation,
          sessionId: "second-session",
          taskGeneration: 1,
          lastKnownLifecycle: "stopped"
        }
      ],
      settings: { section: "extensions", scope: "project", workspaceId: first.id }
    });

    const removed = removeWorkspaceRegistration(state, first.id);

    expect(removed).toMatchObject({
      workspaceOrder: [second.id],
      currentWorkspaceId: second.id,
      selectedSurface: { kind: "workspace", workspaceId: second.id },
      runtimeRecovery: [{ taskId: "second-task" }],
      settings: { section: "extensions", scope: "global" }
    });
    expect(removeWorkspaceRegistration(removed, "missing-workspace")).toBe(removed);
    expect(() => repairWorkspaceRegistration(removed, "missing-workspace", first)).toThrow(/not found/u);
    expect(() => replaceWorkspaceRegistrations(removed, [])).toThrow(/preserve registration/u);
    expect(() => reorderWorkspaceRegistrations(removed, [])).toThrow(/exact permutation/u);
  });

  it("accepts only bounded referentially valid V2 layout metadata", () => {
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "31");
    const state = addOrRefreshWorkspace(createEmptyWorkbenchState(), workspace).state;
    const conversation = {
      kind: "session" as const,
      workspaceId: workspace.id,
      sessionPath: "/sessions/task-1.jsonl"
    };
    const layout = {
      currentWorkspaceId: workspace.id,
      expandedWorkspaceIds: [workspace.id],
      selectedSurface: { kind: "conversation" as const, conversation },
      runtimeRecovery: [{
        taskId: "task-1",
        conversation,
        sessionId: "session-1",
        taskGeneration: 2,
        lastKnownLifecycle: "running" as const
      }],
      settings: { section: "packages" as const, scope: "project" as const, workspaceId: workspace.id }
    };

    expect(replaceWorkbenchLayout(state, layout)).toMatchObject({
      ...layout,
      settings: { ...layout.settings, section: "extensions" }
    });
    expect(() => replaceWorkbenchLayout(state, { ...layout, credential: "secret" })).toThrow(/invalid/u);
    expect(() => replaceWorkbenchLayout(state, { ...layout, expandedWorkspaceIds: ["unknown"] })).toThrow(/invalid/u);
    expect(() => replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "account", scope: "project", workspaceId: workspace.id }
    })).toThrow(/invalid/u);
  });

  it("normalizes the former V2 resources section to skills without resetting state", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "32");
    await mkdir(directory);
    await writeFile(join(directory, WORKBENCH_STATE_FILENAME), JSON.stringify({
      version: 2,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: { kind: "workspace", workspaceId: workspace.id },
      runtimeRecovery: [],
      settings: { section: "resources", scope: "project", workspaceId: workspace.id },
      cleanExit: true
    }), { mode: 0o600 });

    const loaded = await testStore(userData).load();
    expect(loaded.recovery).toBeUndefined();
    expect(loaded.state.settings).toEqual({
      section: "skills",
      scope: "project",
      workspaceId: workspace.id
    });
  });

  it("normalizes the combined prompts and rules section to prompts without resetting state", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "33");
    await mkdir(directory);
    await writeFile(join(directory, WORKBENCH_STATE_FILENAME), JSON.stringify({
      version: 2,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: { kind: "workspace", workspaceId: workspace.id },
      runtimeRecovery: [],
      settings: { section: "prompts-rules", scope: "project", workspaceId: workspace.id },
      cleanExit: true
    }), { mode: 0o600 });

    const loaded = await testStore(userData).load();
    expect(loaded.recovery).toBeUndefined();
    expect(loaded.state.settings).toEqual({
      section: "prompts",
      scope: "project",
      workspaceId: workspace.id
    });
  });

  it("normalizes the former package category into the unified extension workspace", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "34");
    await mkdir(directory);
    await writeFile(join(directory, WORKBENCH_STATE_FILENAME), JSON.stringify({
      version: 2,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      expandedWorkspaceIds: [workspace.id],
      currentWorkspaceId: workspace.id,
      selectedSurface: { kind: "settings" },
      runtimeRecovery: [],
      settings: { section: "packages", scope: "project", workspaceId: workspace.id },
      cleanExit: true
    }), { mode: 0o600 });

    const loaded = await testStore(userData).load();
    expect(loaded.state.settings).toEqual({
      section: "extensions",
      scope: "project",
      workspaceId: workspace.id
    });
  });

  it("marks formerly live recovery records stopped after a clean exit and lost after an unclean exit", () => {
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "41");
    const base = addOrRefreshWorkspace(createEmptyWorkbenchState(), workspace).state;
    const conversation = { kind: "provisional" as const, workspaceId: workspace.id, draftId: "running-task" };
    const withRecovery = replaceWorkbenchLayout(base, {
      currentWorkspaceId: workspace.id,
      expandedWorkspaceIds: [workspace.id],
      selectedSurface: { kind: "conversation", conversation },
      runtimeRecovery: [{
        taskId: "running-task",
        conversation,
        sessionId: "running-session",
        taskGeneration: 1,
        lastKnownLifecycle: "running"
      }],
      settings: { section: "general", scope: "global" }
    });

    expect(beginWorkbenchRun(withRecovery).runtimeRecovery[0]?.lastKnownLifecycle).toBe("lost");
    expect(beginWorkbenchRun(finishWorkbenchRun(withRecovery)).runtimeRecovery[0]?.lastKnownLifecycle).toBe("stopped");
  });

  it("migrates V1 selected sessions and bounded live recovery while leaving idle tabs to Catalog", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "51");
    await mkdir(directory);
    await writeFile(join(directory, LEGACY_WORKBENCH_STATE_FILENAME), JSON.stringify({
      version: 1,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      currentWorkspaceId: workspace.id,
      tasks: [
        legacyTask("running-task", workspace.id, "running", "/sessions/running.jsonl"),
        legacyTask("idle-task", workspace.id, "idle", "/sessions/idle.jsonl")
      ],
      taskOrder: ["running-task", "idle-task"],
      selectedSurface: { kind: "task", taskId: "idle-task" },
      settings: { open: false, section: "extensions", scope: "project", workspaceId: workspace.id },
      cleanExit: false
    }), { mode: 0o600 });

    const loaded = await testStore(userData).load();

    expect(loaded.recovery).toEqual({ kind: "migrated-v1" });
    expect(loaded.state).toMatchObject({
      version: 2,
      selectedSurface: {
        kind: "conversation",
        conversation: { kind: "session", sessionPath: "/sessions/idle.jsonl" }
      },
      runtimeRecovery: [{ taskId: "running-task", lastKnownLifecycle: "running" }]
    });
    expect(await readdir(directory)).toEqual([LEGACY_WORKBENCH_STATE_FILENAME, WORKBENCH_STATE_FILENAME]);
  });

  it("rejects a symlink or junction at the workbench storage boundary", async () => {
    const userData = await temporaryRoot();
    const outside = await temporaryRoot();
    await symlink(outside, join(userData, WORKBENCH_STATE_DIRECTORY), process.platform === "win32" ? "junction" : "dir");
    await expect(testStore(userData).load()).rejects.toThrow(/real directory/u);
  });

  it.runIf(process.platform !== "win32")("repairs existing permissive storage modes", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    await mkdir(directory, { mode: 0o755 });
    await writeFile(join(directory, WORKBENCH_STATE_FILENAME), JSON.stringify(createEmptyWorkbenchState()), { mode: 0o644 });
    await chmod(directory, 0o755);

    await testStore(userData).load();

    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(directory, WORKBENCH_STATE_FILENAME)).mode & 0o777).toBe(0o600);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-workbench-state-"));
  roots.push(root);
  return root;
}

function testStore(userData: string): WorkbenchStateStore {
  return new WorkbenchStateStore(userData, {
    now: () => 1_700_000_000_000,
    createToken: () => "token"
  });
}

function descriptorFixture(id: string, canonicalPath: string, ino = "2"): NativeWorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, device: "1", inode: ino, birthtimeNs: "3", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function legacyTask(taskId: string, workspaceId: string, lastKnownLifecycle: "running" | "idle", sessionPath: string) {
  return {
    taskId,
    workspaceId,
    sessionId: `${taskId}-session`,
    sessionPath,
    visibility: "tab",
    lastKnownLifecycle
  };
}
