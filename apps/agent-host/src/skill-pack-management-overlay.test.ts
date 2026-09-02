import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillPackManagement } from "./skill-pack-management.js";
import {
  activateManagedSkillPack,
  inspectManagedSkillPack,
  managedSkillPackRoot
} from "./managed-skill-pack-state.js";
import {
  aiRelease,
  createAiStaging,
  createFixture
} from "./skill-pack-management-test-support.js";

describe("SkillPackManagement AI Berkshire Overlay", () => {
  it("requires an explicit restore before replacing an invalid managed Overlay", async () => {
    const fixture = await createFixture();
    const release = await aiRelease(fixture.root, "1.0.2");
    const stagingSuiteRoot = join(
      managedSkillPackRoot(fixture.services.agentDir, release.id),
      "..",
      ".ai-berkshire.invalid-active.staging"
    );
    const environment: NodeJS.ProcessEnv = {};
    await createAiStaging(stagingSuiteRoot, release);
    const active = await activateManagedSkillPack({
      agentDir: fixture.services.agentDir,
      id: release.id,
      stagingSuiteRoot,
      environment
    });
    await active.commit();
    await writeFile(join(
      managedSkillPackRoot(fixture.services.agentDir, release.id),
      "package",
      "skills",
      "investment-research",
      "SKILL.md"
    ), "modified\n", "utf8");
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment
    });

    await expect(management.beginUpdate(release.id)).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("restores an existing Overlay when bundled-version projection fails before commit", async () => {
    const fixture = await createFixture();
    const bundled = join(fixture.services.agentDir, "desktop-capabilities", "packages", "pi-workspace-resources");
    await mkdir(bundled, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([bundled])
    };
    const release = await aiRelease(fixture.root, "1.0.2");
    const stagingSuiteRoot = join(
      managedSkillPackRoot(fixture.services.agentDir, release.id),
      "..",
      ".ai-berkshire.restore-projection.staging"
    );
    await createAiStaging(stagingSuiteRoot, release);
    const active = await activateManagedSkillPack({
      agentDir: fixture.services.agentDir,
      id: release.id,
      stagingSuiteRoot,
      environment
    });
    await active.commit();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => "/mock/lark-cli"
    });
    await rm(join(fixture.capabilitiesRoot, "catalog.json"));

    await expect(management.beginRestore(release.id)).rejects.toThrow();
    await expect(inspectManagedSkillPack(fixture.services.agentDir, release.id))
      .resolves.toMatchObject({ status: "valid", state: { version: "1.0.2" } });
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")[0])
      .toBe(join(managedSkillPackRoot(fixture.services.agentDir, release.id), "package"));
  });
});
