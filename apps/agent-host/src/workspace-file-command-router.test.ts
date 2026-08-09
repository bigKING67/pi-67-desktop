import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";
import { WorkspaceFileCommandRouter } from "./workspace-file-command-router.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceFileCommandRouter", () => {
  it("lists lazily, opens bounded UTF-8 text and never follows directory links", async () => {
    const root = await workspaceRoot();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "export const answer = 42;\n", "utf8");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await symlink(join(root, "src"), join(root, "linked-src"), process.platform === "win32" ? "junction" : "dir");
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };

    const page = await router.dispatch(context, { type: "workspace.file.list", payload: {} });
    expect(page).toMatchObject({ workspaceId: "workspace-1", truncated: false });
    if (!("entries" in page)) throw new Error("Expected a Workspace file page.");
    expect(page.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["src", "directory"],
      ["binary.dat", "file"],
      ["linked-src", "symlink"]
    ]);

    const source = page.entries.find((entry) => entry.name === "src");
    if (!source) throw new Error("Missing source directory.");
    const nested = await router.dispatch(context, {
      type: "workspace.file.list",
      payload: { parentId: source.id }
    });
    if (!("entries" in nested)) throw new Error("Expected a nested Workspace file page.");
    const main = nested.entries[0];
    if (!main) throw new Error("Missing source file.");
    await expect(router.dispatch(context, {
      type: "workspace.file.open",
      payload: { id: main.id }
    })).resolves.toMatchObject({
      kind: "text",
      content: "export const answer = 42;\n"
    });

    const binary = page.entries.find((entry) => entry.name === "binary.dat");
    if (!binary) throw new Error("Missing binary file.");
    const binaryPreview = await router.dispatch(context, {
      type: "workspace.file.open",
      payload: { id: binary.id }
    });
    expect(binaryPreview).toMatchObject({ kind: "binary" });
    expect("content" in binaryPreview).toBe(false);

    const link = page.entries.find((entry) => entry.name === "linked-src");
    if (!link) throw new Error("Missing linked directory.");
    await expect(router.dispatch(context, {
      type: "workspace.file.list",
      payload: { parentId: link.id }
    })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("searches by path while skipping .git and generated directories by default", async () => {
    const root = await workspaceRoot();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "src", "feature.ts"), "feature", "utf8");
    await writeFile(join(root, "node_modules", "dependency", "feature.js"), "generated", "utf8");
    await writeFile(join(root, ".git", "feature"), "private metadata", "utf8");
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };

    const defaultPage = await router.dispatch(context, { type: "workspace.file.list", payload: {} });
    if (!("entries" in defaultPage)) throw new Error("Expected a Workspace file page.");
    expect(defaultPage.entries.map((entry) => entry.name)).toEqual(["src"]);
    const completePage = await router.dispatch(context, {
      type: "workspace.file.list",
      payload: { includeGenerated: true }
    });
    if (!("entries" in completePage)) throw new Error("Expected a complete Workspace file page.");
    expect(completePage.entries.map((entry) => entry.name)).toEqual(["node_modules", "src"]);

    await expect(router.dispatch(context, {
      type: "workspace.file.search",
      payload: { query: "feature" }
    })).resolves.toMatchObject({
      entries: [expect.objectContaining({ relativePath: "src/feature.ts" })]
    });
    const included = await router.dispatch(context, {
      type: "workspace.file.search",
      payload: { query: "feature", includeGenerated: true }
    });
    if (!("entries" in included)) throw new Error("Expected Workspace search results.");
    expect(included.entries.map((entry) => entry.relativePath)).toEqual(expect.arrayContaining([
      "src/feature.ts",
      "node_modules/dependency/feature.js"
    ]));
    expect(JSON.stringify(included)).not.toContain(".git/feature");
  });

  it("searches bounded UTF-8 file content without exposing generated or Git metadata", async () => {
    const root = await workspaceRoot();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "src", "feature.ts"), [
      "export function feature() {",
      "  return 'Needle';",
      "}",
      ""
    ].join("\n"), "utf8");
    await writeFile(join(root, "node_modules", "dependency", "feature.js"), "needle", "utf8");
    await writeFile(join(root, ".git", "config"), "needle", "utf8");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };

    const result = await router.dispatch(context, {
      type: "workspace.file.contentSearch",
      payload: { query: "needle" }
    });
    if (!("matches" in result)) throw new Error("Expected Workspace content search results.");
    expect(result.matches).toEqual([expect.objectContaining({
      entry: expect.objectContaining({ relativePath: "src/feature.ts" }),
      line: 2,
      column: 11,
      snippet: "  return 'Needle';"
    })]);
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result)).not.toContain("node_modules");
    expect(JSON.stringify(result)).not.toContain(".git/config");

    const generated = await router.dispatch(context, {
      type: "workspace.file.contentSearch",
      payload: { query: "needle", includeGenerated: true, caseSensitive: true }
    });
    if (!("matches" in generated)) throw new Error("Expected generated content search results.");
    expect(generated.matches.map((match) => match.entry.relativePath)).toEqual([
      "node_modules/dependency/feature.js"
    ]);
    expect(JSON.stringify(generated)).not.toContain(".git/config");
  });

  it("keeps original UTF-16 columns when case folding expands a character", async () => {
    const root = await workspaceRoot();
    await writeFile(join(root, "unicode.txt"), "A\u0130B needle\n", "utf8");
    const result = await routerFor(root).dispatch(
      { scope: "workspace", workspaceId: "workspace-1" },
      { type: "workspace.file.contentSearch", payload: { query: "b NEEDLE" } }
    );

    if (!("matches" in result)) throw new Error("Expected Workspace content search results.");
    expect(result.matches).toEqual([expect.objectContaining({
      line: 1,
      column: 3,
      snippet: "A\u0130B needle"
    })]);
  });

  it("keeps ordinary root files visible while hiding and rejecting .git metadata", async () => {
    const root = await workspaceRoot();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "private metadata", "utf8");
    await writeFile(join(root, "README.md"), "visible", "utf8");
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };

    const page = await router.dispatch(context, { type: "workspace.file.list", payload: {} });
    if (!("entries" in page)) throw new Error("Expected a Workspace file page.");
    expect(page.entries.map((entry) => entry.name)).toEqual(["README.md"]);

    await expect(router.dispatch(context, {
      type: "workspace.file.search",
      payload: { query: "config", includeGenerated: true }
    })).resolves.toMatchObject({ entries: [] });
    await expect(router.dispatch(context, {
      type: "workspace.file.resolve",
      payload: { relativePath: ".git" }
    })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(router.dispatch(context, {
      type: "workspace.file.open",
      payload: { id: "forged-git-reference" }
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("rejects untrusted Workspaces and forged opaque references", async () => {
    const root = await workspaceRoot();
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };
    await expect(routerFor(root, "untrusted").dispatch(context, {
      type: "workspace.file.list",
      payload: {}
    })).rejects.toMatchObject({ code: "WORKSPACE_NOT_TRUSTED" });
    await expect(routerFor(root).dispatch(context, {
      type: "workspace.file.open",
      payload: { id: "forged-reference" }
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("revalidates Prompt file references against current Workspace identity and revision", async () => {
    const root = await workspaceRoot();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "first\n", "utf8");
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };
    const search = await router.dispatch(context, {
      type: "workspace.file.search",
      payload: { query: "main" }
    });
    if (!("entries" in search) || !search.entries[0]) throw new Error("Expected a file search result.");
    const reference = { id: search.entries[0].id, revision: search.entries[0].revision };

    await expect(router.validatePromptReferences("workspace-1", [reference])).resolves.toBeUndefined();
    await expect(router.validatePromptReferences("workspace-1", [reference, reference]))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(router.validatePromptReferences("workspace-1", [{
      id: "forged-reference",
      revision: reference.revision
    }])).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    await writeFile(join(root, "src", "main.ts"), "externally changed and larger\n", "utf8");
    await expect(router.validatePromptReferences("workspace-1", [reference]))
      .rejects.toMatchObject({ code: "RESOURCE_CHANGED_EXTERNALLY" });

    const rootPage = await router.dispatch(context, { type: "workspace.file.list", payload: {} });
    if (!("entries" in rootPage)) throw new Error("Expected a Workspace file page.");
    const directory = rootPage.entries.find((entry) => entry.name === "src");
    if (!directory) throw new Error("Expected the source directory.");
    await expect(router.validatePromptReferences("workspace-1", [{
      id: directory.id,
      revision: directory.revision
    }])).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("creates, saves and renames with idempotency and revision conflict protection", async () => {
    const root = await workspaceRoot();
    const router = routerFor(root);
    const context = { scope: "workspace" as const, workspaceId: "workspace-1" };

    const created = await router.dispatch(context, {
      type: "workspace.file.create",
      payload: { name: "notes.md", kind: "file" }
    }, "create-notes");
    if (!("entry" in created)) throw new Error("Expected a created Workspace file.");

    const saved = await router.dispatch(context, {
      type: "workspace.file.save",
      payload: {
        id: created.entry.id,
        expectedRevision: created.entry.revision,
        content: "first draft\n"
      }
    }, "save-notes");
    if (!("entry" in saved)) throw new Error("Expected a saved Workspace file.");
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("first draft\n");

    await expect(router.dispatch(context, {
      type: "workspace.file.save",
      payload: {
        id: created.entry.id,
        expectedRevision: created.entry.revision,
        content: "first draft\n"
      }
    }, "save-notes")).resolves.toEqual(saved);

    await writeFile(join(root, "notes.md"), "external\n", "utf8");
    await expect(router.dispatch(context, {
      type: "workspace.file.save",
      payload: {
        id: created.entry.id,
        expectedRevision: saved.entry.revision,
        content: "overwrite\n"
      }
    }, "save-conflict")).rejects.toMatchObject({ code: "RESOURCE_CHANGED_EXTERNALLY" });

    const renamed = await router.dispatch(context, {
      type: "workspace.file.rename",
      payload: { id: created.entry.id, name: "journal.md" }
    }, "rename-notes");
    expect(renamed).toMatchObject({ previousRelativePath: "notes.md", entry: { relativePath: "journal.md" } });
    expect(await readFile(join(root, "journal.md"), "utf8")).toBe("external\n");

    await expect(router.dispatch(context, {
      type: "workspace.file.create",
      payload: { name: "CON", kind: "file" }
    }, "invalid-name")).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});

async function workspaceRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-workspace-files-")));
  roots.push(root);
  return root;
}

function routerFor(root: string, trust: "trusted" | "untrusted" = "trusted") {
  const registry = {
    require(workspaceId: string) {
      if (workspaceId !== "workspace-1") throw new Error("Unknown Workspace.");
      return {
        canonicalCwd: root,
        initialization: { trust }
      };
    }
  } as unknown as WorkspaceContextRegistry;
  return new WorkspaceFileCommandRouter(registry);
}
