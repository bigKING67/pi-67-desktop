import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "/Users/me/Pictures") }, dialog: {} }));

import { defaultImageLibraryPath, registerLibrary } from "./image-library-bridge.js";
import { addOrRefreshWorkspace, removeWorkspaceRegistration, replaceWorkbenchLayout } from "./workbench-state-mutations.js";
import { parseWorkbenchStateV5 } from "./workbench-state-contract.js";
import {
  cleanupWorkbenchStateTestRoots,
  temporaryWorkbenchStateRoot,
  workbenchDescriptorFixture,
  workbenchStateTestStore
} from "./workbench-state-test-fixture.js";

afterEach(cleanupWorkbenchStateTestRoots);

describe("creative library location", () => {
  it("prefers the first non-system drive on Windows and Pictures elsewhere", () => {
    const drives = (present: string[]) => (root: string) => present.includes(root);
    expect(defaultImageLibraryPath("win32", "C:", "C:\\Users\\me\\Pictures", drives(["C:\\", "D:\\", "E:\\"]))).toBe("D:\\New Money 创作库");
    expect(defaultImageLibraryPath("win32", "D:", "D:\\Users\\me\\Pictures", drives(["D:\\", "E:\\"]))).toBe("E:\\New Money 创作库");
    expect(defaultImageLibraryPath("win32", undefined, "C:\\Users\\me\\Pictures", drives(["C:\\"]))).toBe("C:\\Users\\me\\Pictures\\New Money 创作库");
    expect(defaultImageLibraryPath("darwin", undefined, "/Users/me/Pictures", () => true)).toBe("/Users/me/Pictures/New Money 创作库");
  });
});

describe("creative library registration", () => {
  it("registers the library without making it the current or an expanded Workspace, and persists it", async () => {
    const store = workbenchStateTestStore(await temporaryWorkbenchStateRoot());
    const library = await registerLibrary(store, workbenchDescriptorFixture("library", "/Volumes/D/New Money 创作库"));
    const first = (await store.load()).state;
    expect(first).toMatchObject({ imageLibraryWorkspaceId: library.id, workspaceOrder: [library.id], expandedWorkspaceIds: [] });
    expect(first.currentWorkspaceId).toBeUndefined();

    await store.update((state) => addOrRefreshWorkspace(state, workbenchDescriptorFixture("repo", "/Users/me/repo", "9")).state);
    const again = await registerLibrary(store, workbenchDescriptorFixture("library-2", "/Volumes/D/New Money 创作库"));
    const state = (await store.load()).state;
    expect(again.id).toBe(library.id);
    expect(state).toMatchObject({ currentWorkspaceId: "repo", imageLibraryWorkspaceId: library.id });
    expect(state.workspaces).toHaveLength(2);
  });

  it("keeps the library id Main-owned, valid and cleared with its Workspace", async () => {
    const store = workbenchStateTestStore(await temporaryWorkbenchStateRoot());
    await registerLibrary(store, workbenchDescriptorFixture("library", "/Volumes/D/lib"));
    const state = (await store.load()).state;
    expect(parseWorkbenchStateV5({ ...state, imageLibraryWorkspaceId: "unknown" })).toBeUndefined();
    expect(() => replaceWorkbenchLayout(state, { expandedWorkspaceIds: [], runtimeRecovery: [], sessionCreationRecovery: [], settings: state.settings, imageLibraryWorkspaceId: "x" })).toThrow();
    expect(replaceWorkbenchLayout(state, { expandedWorkspaceIds: [], runtimeRecovery: [], sessionCreationRecovery: [], settings: state.settings }).imageLibraryWorkspaceId).toBe("library");
    expect(removeWorkspaceRegistration(state, "library").imageLibraryWorkspaceId).toBeUndefined();
  });
});
