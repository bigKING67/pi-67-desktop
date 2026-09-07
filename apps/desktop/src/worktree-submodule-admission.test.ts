import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { it, expect, vi } from "vitest";
import { creationFixture, cleanupCreationFixtures, runSystemGit } from "./worktree-creation-test-fixture.js";
it.each([
  {mode: "local-only", condition: "gitdir:**/modules/**"},
  {mode: "network-explicit", condition: "gitdir:**/modules/**"},
  {mode: "local-only", condition: "onbranch:child-filter"},
] as const)("blocks child-only filters and permits a safe retry: $mode $condition", async ({mode, condition}) => {
  const fixture = await creationFixture();
  try {
    const root = dirname(fixture.repository);
    const module = join(root, "module");
    const config = join(root, "test.gitconfig");
    const marker = join(root, "filter-marker");
    await mkdir(module);
    await runSystemGit(module,["init"]);
    await writeFile(join(module,"payload.txt"),"local content");
    await writeFile(join(module,".gitattributes"),"payload.txt filter=generated\n");
    await runSystemGit(module,["add","--","payload.txt",".gitattributes"]);
    await runSystemGit(module,["-c","user.name=Pi-67","-c","user.email=pi67@example.invalid","commit","-m","module"]);
    await runSystemGit(module, ["branch", "-m", "child-filter"]);
    await runSystemGit(fixture.repository,["-c","protocol.file.allow=always","submodule","add",module,"vendor/module"]);
    await runSystemGit(fixture.repository,["-c","user.name=Pi-67","-c","user.email=pi67@example.invalid","commit","-am","module"]);
    const filterConfig = join(root,"conditional.gitconfig");
    await runSystemGit(fixture.repository,['config','--file',filterConfig,'filter.generated.smudge',`printf controlled > '${marker}'; cat`]);
    await runSystemGit(fixture.repository,['config','--file',config,`includeIf.${condition}.path`,filterConfig]);
    vi.stubEnv("GIT_CONFIG_GLOBAL",config);
    const parentFilters = await fixture.runner.inspectFilters(fixture.repository);
    let target = fixture.repository;
    if (mode === "local-only") {
      const result = await fixture.service.create({requestId:"request-filter",creationId:"creation-filter",sourceWorkspaceId:fixture.source.id});
      expect(result).toMatchObject({status:"created",receipt:{submodules:{status:"incomplete"}}});
      target = (await fixture.runner.listWorktrees(fixture.repository)).find((item) => item.path !== fixture.repository)!.path;
    } else {
      await runSystemGit(fixture.repository,["submodule","deinit","-f","--","vendor/module"]);
      await expect(fixture.runner.initializeSubmodules(fixture.repository,"network-explicit")).rejects.toMatchObject({code:"process-failed",details:{cleanupConfirmed:true}});
      await expect(fixture.runner.inspectSubmodules(fixture.repository)).resolves.toMatchObject({status:"incomplete",uninitialized:1});
    }
    const filterRan = await readFile(marker,"utf8").then(()=>true,()=>false);
    expect(parentFilters.unknownFilterNames).toEqual([]);
    expect(filterRan).toBe(false);
    await expect(readFile(join(target,"vendor/module/payload.txt"))).rejects.toMatchObject({code:"ENOENT"});
    await writeFile(filterConfig, "");
    await fixture.runner.initializeSubmodules(target, mode);
    await expect(fixture.runner.inspectSubmodules(target)).resolves.toMatchObject({status:"complete"});
    await expect(readFile(join(target,"vendor/module/payload.txt"), "utf8")).resolves.toBe("local content");
  } finally {
    vi.unstubAllEnvs();
    await cleanupCreationFixtures();
  }
}, 60_000);

it.each([false, true])("admits nested checkout with an already initialized worktree: %s", async (initialized) => {
  const fixture = await creationFixture();
  try {
    const root = dirname(fixture.repository);
    const leaf = join(root, "leaf");
    const outer = join(root, "outer");
    const config = join(root, "nested.gitconfig");
    const filters = join(root, "nested-filters.gitconfig");
    const marker = join(root, "nested-marker");
    for (const repository of [leaf, outer]) {
      await mkdir(repository);
      await runSystemGit(repository, ["init"]);
      await writeFile(join(repository, "payload.txt"), "nested content");
      await writeFile(join(repository, ".gitattributes"), "payload.txt filter=generated\n");
      await runSystemGit(repository, ["add", "."]);
      await runSystemGit(repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "initial"]);
    }
    await runSystemGit(outer, ["-c", "protocol.file.allow=always", "submodule", "add", leaf, "nested"]);
    await runSystemGit(outer, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "nested"]);
    await runSystemGit(fixture.repository, ["-c", "protocol.file.allow=always", "submodule", "add", outer, "outer"]);
    await runSystemGit(fixture.repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "outer"]);
    await runSystemGit(fixture.repository, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"]);
    if (initialized) {
      await writeFile(join(leaf, "payload.txt"), "second content");
      await runSystemGit(leaf, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "second"]);
      await runSystemGit(join(outer, "nested"), ["-c", "protocol.file.allow=always", "fetch", "origin"]);
      await runSystemGit(join(outer, "nested"), ["checkout", "--detach", "FETCH_HEAD"]);
      await runSystemGit(outer, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "second nested"]);
      await runSystemGit(join(fixture.repository, "outer"), ["-c", "protocol.file.allow=always", "fetch", "origin"]);
      await runSystemGit(join(fixture.repository, "outer"), ["checkout", "--detach", "FETCH_HEAD"]);
      await runSystemGit(fixture.repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "second outer"]);
      await runSystemGit(join(fixture.repository, "outer"), ["checkout", "--detach", "HEAD~1"]);
      // Cache the desired leaf object; production explicit mode must not need file transport.
      await runSystemGit(join(fixture.repository, "outer/nested"), ["-c", "protocol.file.allow=always", "fetch", "origin"]);
    } else {
      await runSystemGit(fixture.repository, ["submodule", "deinit", "-f", "--", "outer"]);
    }
    await runSystemGit(fixture.repository, ["config", "--file", filters, "filter.generated.smudge", `printf controlled > '${marker}'; cat`]);
    await runSystemGit(fixture.repository, ["config", "--file", config, "includeIf.gitdir:**/modules/**/modules/**.path", filters]);
    await runSystemGit(fixture.repository, ["config", "--file", config, "submodule.recurse", "true"]);
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    await expect(fixture.runner.initializeSubmodules(fixture.repository, "network-explicit")).rejects.toMatchObject({ code: "process-failed" });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.repository, "outer/payload.txt"), "utf8")).resolves.toBe("nested content");
    if (initialized) {
      await expect(readFile(join(fixture.repository, "outer/nested/payload.txt"), "utf8")).resolves.toBe("nested content");
    } else {
      await expect(readFile(join(fixture.repository, "outer/nested/payload.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(fixture.runner.inspectSubmodules(fixture.repository)).resolves.toMatchObject({ status: "incomplete" });
    await writeFile(filters, "");
    await fixture.runner.initializeSubmodules(fixture.repository, "network-explicit");
    await expect(readFile(join(fixture.repository, "outer/nested/payload.txt"), "utf8")).resolves.toBe(initialized ? "second content" : "nested content");
  } finally {
    vi.unstubAllEnvs();
    await cleanupCreationFixtures();
  }
}, 60_000);

it("uses an existing old-form child without cloning or moving its Git directory", async () => {
  const fixture = await creationFixture();
  try {
    const child = join(fixture.repository, "child");
    await mkdir(child);
    await runSystemGit(child, ["init"]);
    await writeFile(join(child, "payload.txt"), "owned content");
    await runSystemGit(child, ["add", "."]);
    await runSystemGit(child, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "child"]);
    const leaf = join(dirname(fixture.repository), "old-form-leaf");
    await mkdir(leaf);
    await runSystemGit(leaf, ["init"]);
    await writeFile(join(leaf, "payload.txt"), "leaf content");
    await runSystemGit(leaf, ["add", "."]);
    await runSystemGit(leaf, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "leaf"]);
    await runSystemGit(child, ["-c", "protocol.file.allow=always", "submodule", "add", leaf, "nested"]);
    await runSystemGit(child, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "nested"]);
    await runSystemGit(child, ["submodule", "deinit", "-f", "--", "nested"]);
    await runSystemGit(fixture.repository, ["config", "--file", ".gitmodules", "submodule.child.path", "child"]);
    // A needless clone would fail: explicit mode forbids this file transport.
    await runSystemGit(fixture.repository, ["config", "--file", ".gitmodules", "submodule.child.url", child]);
    // More than 1 MiB of unrelated tracked path names must not consume the
    // submodule output budget when the active pathspec is broad.
    const ordinary = join(fixture.repository, ...Array.from({ length: 5 }, (_, index) => `${index}-${"x".repeat(100)}`));
    expect(Buffer.byteLength(ordinary.slice(fixture.repository.length + 1)) * 2200).toBeGreaterThan(1024 * 1024);
    await mkdir(ordinary, { recursive: true });
    await Promise.all(Array.from({ length: 2200 }, (_, index) => writeFile(join(ordinary, `${index}.txt`), "x")));
    await runSystemGit(fixture.repository, ["-c", "core.longpaths=true", "add", "--", ".gitmodules", "child", ordinary]);
    await runSystemGit(fixture.repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "parent"]);
    await runSystemGit(fixture.repository, ["config", "submodule.active", "."]);
    await runSystemGit(fixture.repository, ["config", "submodule.child.active", "false"]);
    await fixture.runner.initializeSubmodules(fixture.repository, "network-explicit");
    await expect(readFile(join(child, "nested/payload.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await runSystemGit(fixture.repository, ["config", "--unset", "submodule.child.active"]);
    await runSystemGit(fixture.repository, ["config", "submodule.active", ":(exclude)child"]);
    await fixture.runner.initializeSubmodules(fixture.repository, "network-explicit");
    await expect(readFile(join(child, "nested/payload.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await runSystemGit(fixture.repository, ["config", "submodule.child.active", "true"]);
    await fixture.runner.initializeSubmodules(fixture.repository, "network-explicit");
    await expect(readFile(join(child, ".git/HEAD"), "utf8")).resolves.toMatch(/ref: refs\/heads\//u);
    await expect(readFile(join(child, "payload.txt"), "utf8")).resolves.toBe("owned content");
    await expect(readFile(join(child, "nested/payload.txt"), "utf8")).resolves.toBe("leaf content");
    await expect(readFile(join(fixture.repository, ".git/modules/child/HEAD"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await cleanupCreationFixtures();
  }
}, 60_000);
