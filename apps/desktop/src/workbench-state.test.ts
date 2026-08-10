import { lstatSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addOrRefreshWorkspace,
  beginWorkbenchRun,
  createEmptyWorkbenchState,
  finishWorkbenchRun,
  MAX_RUNTIME_RECOVERY_RECORDS,
  MAX_WORKBENCH_STATE_BYTES,
  removeWorkspaceRegistration,
  repairWorkspaceRegistration,
  reorderWorkspaceRegistrations,
  replaceWorkspaceRegistrations,
  replaceWorkbenchLayout,
  UnsupportedWorkbenchStateVersionError,
  WORKBENCH_STATE_DIRECTORY,
  WORKBENCH_STATE_FILENAME,
  type WorkbenchStateV5
} from "./workbench-state.js";
import {
  cleanupWorkbenchStateTestRoots,
  temporaryWorkbenchStateRoot as temporaryRoot,
  workbenchDescriptorFixture as descriptorFixture,
  workbenchRecoveryRecord as recoveryRecord,
  workbenchStateTestStore as testStore
} from "./workbench-state-test-fixture.js";

afterEach(cleanupWorkbenchStateTestRoots);

describe("WorkbenchStateV5 persistence", () => {
  it("marks a missing persisted state as first-run initialization", async () => {
    const loaded = await testStore(await temporaryRoot()).load();

    expect(loaded).toEqual({
      state: createEmptyWorkbenchState(),
      recovery: { kind: "initialized" }
    });
  });

  it("writes the canonical V5 state atomically with POSIX-private modes", async () => {
    const userData = await temporaryRoot();
    const store = testStore(userData);
    const workspace = descriptorFixture("workspace-1", join(userData, "workspace-1"));

    const saved = await store.update((state) => addOrRefreshWorkspace(state, workspace).state);
    const serialized = await readFile(store.requestedStatePath, "utf8");
    const directoryEntries = await readdir(join(userData, WORKBENCH_STATE_DIRECTORY));

    expect(saved).toMatchObject({
      version: 5,
      expandedWorkspaceIds: [workspace.id],
      runtimeRecovery: [],
      workspaceEnvironments: [{ workspaceId: workspace.id, kind: "plain", ownership: "user" }],
      environmentMutations: []
    });
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

  it("quarantines malformed and oversized V5 state before resetting", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    await mkdir(directory);
    await writeFile(statePath, "{not-json", { mode: 0o600 });

    const malformed = await testStore(userData).load();

    expect(malformed.state).toEqual(createEmptyWorkbenchState());
    expect(malformed.recovery).toEqual({
      kind: "corrupt-reset",
      quarantinedFileName: "state-v5.corrupt-1700000000000-token.json"
    });
    expect(await readdir(directory)).toEqual(["state-v5.corrupt-1700000000000-token.json"]);

    await writeFile(statePath, "x".repeat(MAX_WORKBENCH_STATE_BYTES + 1), { mode: 0o600 });
    await expect(testStore(userData).load()).resolves.toMatchObject({ recovery: { kind: "corrupt-reset" } });
  });

  it("fails closed on a future version without quarantining or overwriting it", async () => {
    const userData = await temporaryRoot();
    const directory = join(userData, WORKBENCH_STATE_DIRECTORY);
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    const future = '{"version":6,"future":true}\n';
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
    const state = createEmptyWorkbenchState() as WorkbenchStateV5 & {
      prompt?: string;
      draft?: string;
      credential?: string;
    };
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
      sessionFileIdentity: "session-file-first",
      sessionPath: "/sessions/first.jsonl"
    };
    const secondConversation = {
      kind: "session" as const,
      workspaceId: second.id,
      sessionFileIdentity: "session-file-second",
      sessionPath: "/sessions/second.jsonl"
    };
    state = replaceWorkbenchLayout(state, {
      currentWorkspaceId: first.id,
      expandedWorkspaceIds: [first.id, second.id],
      selectedSurface: { kind: "conversation", conversation: firstConversation },
      runtimeRecovery: [
        recoveryRecord("first-task", firstConversation, { sessionId: "first-session" }),
        recoveryRecord("second-task", secondConversation, {
          sessionId: "second-session",
          lastKnownLifecycle: "stopped"
        })
      ],
      sessionCreationRecovery: [],
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

  it("accepts only bounded referentially valid V4 layout metadata", () => {
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "31");
    const state = addOrRefreshWorkspace(createEmptyWorkbenchState(), workspace).state;
    const conversation = {
      kind: "session" as const,
      workspaceId: workspace.id,
      sessionFileIdentity: "session-file-task-1",
      sessionPath: "/sessions/task-1.jsonl"
    };
    const layout = {
      currentWorkspaceId: workspace.id,
      expandedWorkspaceIds: [workspace.id],
      selectedSurface: { kind: "conversation" as const, conversation },
      runtimeRecovery: [recoveryRecord("task-1", conversation, {
        sessionId: "session-1",
        taskGeneration: 2
      })],
      sessionCreationRecovery: [],
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
    expect(replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "mcp" as never, scope: "global" }
    }).settings).toEqual({ section: "integrations", scope: "global" });
    expect(replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "usage", scope: "project", workspaceId: workspace.id }
    }).settings).toEqual({ section: "usage", scope: "project", workspaceId: workspace.id });
    expect(replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "integrations", scope: "global" }
    }).settings).toEqual({ section: "integrations", scope: "global" });
    expect(replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "lark", scope: "global" }
    }).settings).toEqual({ section: "lark", scope: "global" });
    expect(() => replaceWorkbenchLayout(state, {
      ...layout,
      settings: { section: "lark", scope: "project", workspaceId: workspace.id }
    })).toThrow(/invalid/u);

    const boundedRecovery = Array.from({ length: MAX_RUNTIME_RECOVERY_RECORDS }, (_, index) => recoveryRecord(
      `task-${index}`,
      {
        kind: "session" as const,
        workspaceId: workspace.id,
        sessionFileIdentity: `session-file-task-${index}`,
        sessionPath: `/sessions/task-${index}.jsonl`
      },
      { sessionId: `session-${index}` }
    ));
    expect(replaceWorkbenchLayout(state, { ...layout, runtimeRecovery: boundedRecovery }).runtimeRecovery)
      .toHaveLength(MAX_RUNTIME_RECOVERY_RECORDS);
    expect(() => replaceWorkbenchLayout(state, {
      ...layout,
      runtimeRecovery: [...boundedRecovery, recoveryRecord(
        "task-over-limit",
        {
          kind: "session",
          workspaceId: workspace.id,
          sessionFileIdentity: "session-file-task-over-limit",
          sessionPath: "/sessions/task-over-limit.jsonl"
        },
        { sessionId: "session-over-limit" }
      )]
    })).toThrow(/invalid/u);
  });

  it("marks live recovery lost after an unclean exit and clears it on a clean exit", () => {
    const workspace = descriptorFixture("workspace-1", "/workspace/first", "41");
    const base = addOrRefreshWorkspace(createEmptyWorkbenchState(), workspace).state;
    const conversation = {
      kind: "session" as const,
      workspaceId: workspace.id,
      sessionFileIdentity: "session-file-v1\0device\0inode\0birthtime",
      sessionPath: "/sessions/running.jsonl"
    };
    const withRecovery = replaceWorkbenchLayout(base, {
      currentWorkspaceId: workspace.id,
      expandedWorkspaceIds: [workspace.id],
      selectedSurface: { kind: "conversation", conversation },
      runtimeRecovery: [recoveryRecord("running-task", conversation, {
        sessionId: "running-session"
      })],
      sessionCreationRecovery: [],
      settings: { section: "general", scope: "global" }
    });

    expect(beginWorkbenchRun(withRecovery).runtimeRecovery[0]?.lastKnownLifecycle).toBe("lost");
    expect(beginWorkbenchRun(withRecovery).runtimeRecovery[0]?.conversation.sessionFileIdentity)
      .toBe("session-file-v1\0device\0inode\0birthtime");
    expect(finishWorkbenchRun(withRecovery)).toMatchObject({ cleanExit: true, runtimeRecovery: [] });
    expect(beginWorkbenchRun(finishWorkbenchRun(withRecovery)).runtimeRecovery).toEqual([]);
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
