import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addOrRefreshWorkspace, WorkbenchStateStore } from "./workbench-state.js";
import { resolveRegisteredWorkspaceEntry, workspaceEntryLaunchesCode, workspaceEntryRevealAction } from "./workspace-entry.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveRegisteredWorkspaceEntry", () => {
  it("revalidates registered files and rejects traversal, Git metadata and links", async () => {
    const workspaceRoot = await temporary("pi67-native-entry-workspace-");
    const userData = await temporary("pi67-native-entry-state-");
    await mkdir(join(workspaceRoot, "src"));
    await mkdir(join(workspaceRoot, ".git"));
    await writeFile(join(workspaceRoot, "src", "main.ts"), "export {};\n", "utf8");
    await symlink(join(workspaceRoot, "src", "main.ts"), join(workspaceRoot, "linked.ts"), "file");
    const workspace = await createNativeWorkspaceDescriptor(workspaceRoot, { createId: () => "workspace-1" });
    const store = new WorkbenchStateStore(userData);
    await store.update((state) => ({
      ...addOrRefreshWorkspace(state, workspace).state,
      selectedSurface: { kind: "workspace", workspaceId: workspace.id }
    }));

    await expect(resolveRegisteredWorkspaceEntry(store, {
      workspaceId: workspace.id,
      relativePath: "src/main.ts",
      kind: "file"
    })).resolves.toMatchObject({ absolutePath: await realpath(join(workspaceRoot, "src", "main.ts")) });
    await expect(resolveRegisteredWorkspaceEntry(store, {
      workspaceId: workspace.id,
      relativePath: "../escape",
      kind: "file"
    })).rejects.toThrow("path is invalid");
    await expect(resolveRegisteredWorkspaceEntry(store, {
      workspaceId: workspace.id,
      relativePath: ".git/config",
      kind: "file"
    })).rejects.toThrow("path is invalid");
    await expect(resolveRegisteredWorkspaceEntry(store, {
      workspaceId: workspace.id,
      relativePath: "linked.ts",
      kind: "symlink"
    })).rejects.toThrow("Symbolic links");
  });
});

async function temporary(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

describe("workspaceEntryRevealAction", () => {
  it("never launches an entry when revealing it", () => {
    expect(workspaceEntryRevealAction({ kind: "file", absolutePath: "/w/run.command" }, "darwin")).toBe("show-in-folder");
    expect(workspaceEntryRevealAction({ kind: "directory", absolutePath: "/w/Tool.app" }, "darwin")).toBe("show-in-folder");
    expect(workspaceEntryRevealAction({ kind: "directory", absolutePath: "/w/Tool.APP" }, "darwin")).toBe("show-in-folder");
    expect(workspaceEntryRevealAction({ kind: "other", absolutePath: "/w/socket" }, "darwin")).toBe("show-in-folder");
  });

  it("opens plain directories in the file manager", () => {
    expect(workspaceEntryRevealAction({ kind: "directory", absolutePath: "/w/src" }, "darwin")).toBe("open-directory");
    expect(workspaceEntryRevealAction({ kind: "directory", absolutePath: "C:\\w\\Tool.app" }, "win32")).toBe("open-directory");
  });
});

describe("workspaceEntryLaunchesCode", () => {
  const file = (absolutePath: string) => ({ kind: "file" as const, absolutePath });
  it("flags launchers, macOS app bundles and POSIX executables", () => {
    expect(workspaceEntryLaunchesCode(file("C:\\w\\setup.EXE"), 0o644, "win32")).toBe(true);
    expect(workspaceEntryLaunchesCode(file("C:\\w\\run.ps1"), 0o644, "win32")).toBe(true);
    expect(workspaceEntryLaunchesCode(file("/w/run.command"), 0o644, "darwin")).toBe(true);
    expect(workspaceEntryLaunchesCode({ kind: "directory", absolutePath: "/w/Tool.app" }, 0o755, "darwin")).toBe(true);
    expect(workspaceEntryLaunchesCode(file("/w/build/tool"), 0o755, "darwin")).toBe(true);
    expect(workspaceEntryLaunchesCode(file("/w/install.sh"), 0o644, "linux")).toBe(true);
  });

  it("lets documents and plain directories open without confirmation", () => {
    expect(workspaceEntryLaunchesCode(file("/w/README.md"), 0o644, "darwin")).toBe(false);
    expect(workspaceEntryLaunchesCode(file("C:\\w.d\\notes"), 0o644, "win32")).toBe(false);
    expect(workspaceEntryLaunchesCode(file("C:\\w\\report.pdf"), 0o755, "win32")).toBe(false);
    expect(workspaceEntryLaunchesCode({ kind: "directory", absolutePath: "/w/src" }, 0o755, "darwin")).toBe(false);
    expect(workspaceEntryLaunchesCode({ kind: "directory", absolutePath: "C:\\w\\Tool.app" }, 0o755, "win32")).toBe(false);
  });
});
