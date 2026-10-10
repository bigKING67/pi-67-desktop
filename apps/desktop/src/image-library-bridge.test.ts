import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "/Users/me/Pictures") }, dialog: {} }));

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultImageLibraryPath, registerLibrary, writeImageExportSet } from "./image-library-bridge.js";
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

describe("image export sets", () => {
  // A PNG signature plus an IHDR header is all the receipt reads.
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
  };
  const item = (projectId: string, fileName: string) => ({ projectId, revision: 3, pngSha256: "a".repeat(64), fileName });

  it("writes every size and a receipt into a new folder, never over an existing one or file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "image-export-"));
    try {
      const now = new Date(2026, 9, 10, 14, 5, 9);
      await mkdir(join(parent, "春日茶礼 导出 2026-10-10 140509"));
      const folder = await writeImageExportSet(parent, "春日茶礼", [
        { item: item("spring", "春日茶礼"), bytes: png(1080, 1670) },
        { item: item("spring-4x5", "春日茶礼 · 4:5"), bytes: png(1080, 1350) },
        { item: item("spring-4x5-2", "春日茶礼 · 4:5"), bytes: png(1080, 1350) }
      ], now);
      expect(folder).toBe("春日茶礼 导出 2026-10-10 140509 2");
      expect((await readdir(join(parent, folder))).sort()).toEqual(["receipt.json", "春日茶礼 · 4_5-2.png", "春日茶礼 · 4_5.png", "春日茶礼.png"]);
      const receipt = JSON.parse(await readFile(join(parent, folder, "receipt.json"), "utf8")) as { schema: string; items: { file: string; project_id: string; width: number; height: number; revision: number }[] };
      expect(receipt.schema).toBe("pi67.image-export-set.v1");
      expect(receipt.items.map(({ file, project_id, width, height, revision }) => [file, project_id, width, height, revision])).toEqual([
        ["春日茶礼.png", "spring", 1080, 1670, 3], ["春日茶礼 · 4_5.png", "spring-4x5", 1080, 1350, 3], ["春日茶礼 · 4_5-2.png", "spring-4x5-2", 1080, 1350, 3]
      ]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

