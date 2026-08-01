import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_CONTEXT_FILE_BYTES } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import { createContextFileManagement } from "./context-file-management.js";
import { createInMemoryPiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("context file management", () => {
  it("classifies managed, global, project, inherited, and system prompt files", async () => {
    const fixture = await createFixture(true);
    const managedRoot = join(fixture.agentDir, "rules", "pi67-desktop");
    await mkdir(managedRoot, { recursive: true });
    await Promise.all(Array.from({ length: 11 }, (_, index) => (
      writeFile(join(managedRoot, `rule-${index + 1}.md`), `# Rule ${index + 1}\n`)
    )));
    await writeFile(join(fixture.agentDir, "AGENTS.md"), "# Global\n");
    await writeFile(join(fixture.agentDir, "SYSTEM.md"), "global system\n");
    await writeFile(join(fixture.root, "AGENTS.md"), "# Parent\n");
    await writeFile(join(fixture.cwd, "AGENTS.md"), "# Project\n");
    await mkdir(join(fixture.cwd, ".pi"), { recursive: true });
    await writeFile(join(fixture.cwd, ".pi", "SYSTEM.md"), "project system\n");

    const catalog = await fixture.management.list();
    expect(catalog.workspaceTrusted).toBe(true);
    expect(catalog.items.filter((item) => item.scope === "managed")).toHaveLength(11);
    expect(catalog.items.filter((item) => item.scope === "managed").every((item) => (
      item.access === "read-only" && item.runtimeState === "active"
    ))).toBe(true);
    expect(find(catalog.items, join(fixture.agentDir, "SYSTEM.md")).runtimeState).toBe("overridden");
    expect(find(catalog.items, join(fixture.cwd, ".pi", "SYSTEM.md")).runtimeState).toBe("active");
    expect(find(catalog.items, join(fixture.root, "AGENTS.md"))).toMatchObject({
      scope: "inherited",
      access: "read-only"
    });
  });

  it("uses optimistic revisions and rolls an existing file back exactly", async () => {
    const fixture = await createFixture(true);
    const path = join(fixture.agentDir, "AGENTS.md");
    await writeFile(path, "# Original\n\nKeep spacing.\n");
    const item = find((await fixture.management.list()).items, path);
    const opened = await fixture.management.read(item.id);
    const transaction = await fixture.management.beginSave(
      item.id,
      opened.revision,
      "# Updated\n"
    );
    expect(await readFile(path, "utf8")).toBe("# Updated\n");
    await transaction.rollback();
    expect(await readFile(path, "utf8")).toBe(opened.content);

    const reopened = await fixture.management.read(item.id);
    const committed = await fixture.management.beginSave(item.id, reopened.revision, "# Final");
    await committed.commit();
    expect(await readFile(path, "utf8")).toBe("# Final");
  });

  it("deduplicates context name aliases that resolve to the same physical file", async () => {
    const fixture = await createFixture(true);
    const canonicalPath = join(fixture.agentDir, "AGENTS.md");
    const aliasPath = join(fixture.agentDir, "AGENTS.MD");
    await writeFile(canonicalPath, "# Global\n");
    try {
      await link(canonicalPath, aliasPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }

    const rules = (await fixture.management.list()).items.filter((item) => (
      item.scope === "global" && item.category === "rules-context"
    ));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ path: canonicalPath, runtimeState: "active" });
  });

  it("creates only catalog candidates and refuses to overwrite an externally created file", async () => {
    const fixture = await createFixture(true);
    const path = join(fixture.agentDir, "APPEND_SYSTEM.md");
    const item = find((await fixture.management.list()).items, path);
    expect(item).toMatchObject({ presence: "missing", access: "creatable" });
    const opened = await fixture.management.read(item.id);
    await writeFile(path, "external\n");
    await expect(fixture.management.beginSave(item.id, opened.revision, "desktop\n"))
      .rejects.toMatchObject({ code: "RESOURCE_CHANGED_EXTERNALLY" });
    expect(await readFile(path, "utf8")).toBe("external\n");
  });

  it("fails closed for untrusted project writes, symlinks, invalid UTF-8, and oversized content", async () => {
    const untrusted = await createFixture(false);
    const projectPath = join(untrusted.cwd, "AGENTS.md");
    await writeFile(projectPath, "# Project\n");
    const projectItem = find((await untrusted.management.list()).items, projectPath);
    await expect(untrusted.management.mutationScope(projectItem.id))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_TRUSTED" });

    const trusted = await createFixture(true);
    const outside = join(trusted.root, "outside.md");
    const globalPath = join(trusted.agentDir, "AGENTS.md");
    await writeFile(outside, "outside\n");
    await symlink(outside, globalPath);
    const symlinkItem = find((await trusted.management.list()).items, globalPath);
    await expect(trusted.management.read(symlinkItem.id))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });

    await rm(globalPath);
    await writeFile(globalPath, Buffer.from([0xff, 0xfe, 0xfd]));
    const invalidItem = find((await trusted.management.list()).items, globalPath);
    await expect(trusted.management.read(invalidItem.id))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await writeFile(globalPath, "valid\n");
    const validItem = find((await trusted.management.list()).items, globalPath);
    const opened = await trusted.management.read(validItem.id);
    await expect(trusted.management.beginSave(
      validItem.id,
      opened.revision,
      "中".repeat(Math.ceil(MAX_CONTEXT_FILE_BYTES / 3) + 1)
    )).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });
});

async function createFixture(projectTrusted: boolean) {
  const root = await mkdtemp(join(tmpdir(), "pi67-context-files-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const services = createInMemoryPiWorkspaceRuntimeServices({ cwd, agentDir, projectTrusted });
  return {
    root,
    cwd,
    agentDir,
    services,
    management: createContextFileManagement(services)
  };
}

function find(items: Awaited<ReturnType<ReturnType<typeof createContextFileManagement>["list"]>>["items"], path: string) {
  const item = items.find((candidate) => candidate.path === path);
  if (!item) throw new Error(`Missing context item for ${path}`);
  return item;
}
