import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { cleanupCreationFixtures, creationFixture, runSystemGit } from "./worktree-creation-test-fixture.js";

it.each(["local-only", "network-explicit"] as const)("disables inherited submodule checkout hooks in %s", async (mode) => {
  const fixture = await creationFixture();
  try {
    const root = dirname(fixture.repository);
    const module = join(root, "module");
    const hooks = join(root, "hooks");
    const config = join(root, "test.gitconfig");
    const marker = join(root, "hook-marker");
    await mkdir(module);
    await mkdir(hooks);
    await runSystemGit(module, ["init"]);
    await writeFile(join(module, "payload.txt"), "local content");
    await runSystemGit(module, ["add", "--", "payload.txt"]);
    await runSystemGit(module, ["-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid", "commit", "-m", "module"]);
    await runSystemGit(fixture.repository, ["-c", "protocol.file.allow=always", "submodule", "add", module, "vendor/module"]);
    await runSystemGit(fixture.repository, ["-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid", "commit", "-am", "module"]);
    await writeFile(join(hooks, "post-checkout"), `#!/bin/sh\nprintf controlled >> '${marker}'\n`);
    await chmod(join(hooks, "post-checkout"), 0o755);
    await runSystemGit(fixture.repository, ["config", "--file", config, "core.hooksPath", hooks]);
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    if (mode === "local-only") {
      const result = await fixture.service.create({
        requestId: "request-module-hook",
        creationId: "creation-module-hook",
        sourceWorkspaceId: fixture.source.id,
      });
      expect(result).toMatchObject({ status: "created", receipt: { submodules: { status: "complete" } } });
    } else {
      await runSystemGit(fixture.repository, ["submodule", "deinit", "-f", "--", "vendor/module"]);
      await fixture.runner.initializeSubmodules(fixture.repository, "network-explicit");
      await expect(fixture.runner.inspectSubmodules(fixture.repository)).resolves.toMatchObject({ status: "complete" });
    }
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
    await cleanupCreationFixtures();
  }
}, 20_000);
