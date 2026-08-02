import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchStateStore } from "./workbench-state.js";
import { resolveRegisteredWorkspaceEntry } from "./workspace-entry.js";
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
      ...state,
      workspaces: [workspace],
      workspaceOrder: [workspace.id],
      currentWorkspaceId: workspace.id,
      expandedWorkspaceIds: [workspace.id],
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
