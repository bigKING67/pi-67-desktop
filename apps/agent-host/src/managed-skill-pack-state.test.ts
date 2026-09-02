import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateManagedSkillPack,
  hashManagedSkillSet,
  inspectManagedSkillPack,
  managedPackageTreeSha256,
  managedSkillPackRoot,
  removeManagedSkillPack,
  writeManagedSkillPackState
} from "./managed-skill-pack-state.js";

const PACK_ID = "ai-berkshire-investment-suite";

describe("managed Skill Pack state", () => {
  it("atomically activates, rolls back, restores, and keeps Overlay paths before bundled packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-managed-pack-"));
    const agentDir = join(root, "agent");
    const stableRoot = managedSkillPackRoot(agentDir, PACK_ID);
    const parent = dirname(stableRoot);
    const bundled = join(agentDir, "desktop-capabilities", "packages", "pi-workspace-resources");
    await mkdir(bundled, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([bundled])
    };

    const firstStaging = join(parent, ".ai-berkshire.first.staging");
    await createStaging(firstStaging, "1.0.2");
    const firstSwap = await activateManagedSkillPack({
      agentDir,
      id: PACK_ID,
      stagingSuiteRoot: firstStaging,
      environment,
      createToken: () => "first"
    });
    const active = await inspectManagedSkillPack(agentDir, PACK_ID);
    expect(active).toMatchObject({ status: "valid", state: { version: "1.0.2" } });
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual([
      join(stableRoot, "package"),
      bundled
    ]);

    await firstSwap.rollback();
    await expect(inspectManagedSkillPack(agentDir, PACK_ID)).resolves.toMatchObject({ status: "absent" });
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual([bundled]);

    const secondStaging = join(parent, ".ai-berkshire.second.staging");
    await createStaging(secondStaging, "1.0.2");
    const secondSwap = await activateManagedSkillPack({
      agentDir,
      id: PACK_ID,
      stagingSuiteRoot: secondStaging,
      environment,
      createToken: () => "second"
    });
    await secondSwap.commit();
    const removed = await removeManagedSkillPack({
      agentDir,
      id: PACK_ID,
      environment,
      createToken: () => "restore"
    });
    expect(removed.changed).toBe(true);
    await removed.swap.rollback();
    await expect(inspectManagedSkillPack(agentDir, PACK_ID)).resolves.toMatchObject({ status: "valid" });
    expect(await readFile(join(stableRoot, "package", "skills", "investment-research", "SKILL.md"), "utf8"))
      .toContain("investment-research");
  });

  it("fails closed when the active Package tree is modified", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-managed-pack-invalid-"));
    const agentDir = join(root, "agent");
    const stableRoot = managedSkillPackRoot(agentDir, PACK_ID);
    const staging = join(dirname(stableRoot), ".ai-berkshire.invalid.staging");
    await createStaging(staging, "1.0.2");
    const swap = await activateManagedSkillPack({ agentDir, id: PACK_ID, stagingSuiteRoot: staging });
    await swap.commit();
    await writeFile(join(stableRoot, "package", "skills", "investment-research", "SKILL.md"), "modified\n");
    await expect(inspectManagedSkillPack(agentDir, PACK_ID)).resolves.toMatchObject({
      status: "invalid",
      detail: expect.stringContaining("完整性")
    });
  });

  it("preserves the active Overlay when allocating its backup path fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-managed-pack-backup-failure-"));
    const agentDir = join(root, "agent");
    const stableRoot = managedSkillPackRoot(agentDir, PACK_ID);
    const parent = dirname(stableRoot);
    const initialStaging = join(parent, ".ai-berkshire.initial.staging");
    await createStaging(initialStaging, "1.0.2");
    const initial = await activateManagedSkillPack({
      agentDir,
      id: PACK_ID,
      stagingSuiteRoot: initialStaging,
      createToken: () => "initial"
    });
    await initial.commit();

    const collisionToken = "collision";
    const collisionBackup = join(parent, `.${PACK_ID}.${process.pid}.${collisionToken}.backup`);
    await mkdir(collisionBackup, { recursive: true });
    await writeFile(join(collisionBackup, "occupied"), "occupied\n", "utf8");
    const nextStaging = join(parent, ".ai-berkshire.next.staging");
    await createStaging(nextStaging, "1.0.3");

    await expect(activateManagedSkillPack({
      agentDir,
      id: PACK_ID,
      stagingSuiteRoot: nextStaging,
      createToken: () => collisionToken
    })).rejects.toThrow();
    await expect(inspectManagedSkillPack(agentDir, PACK_ID)).resolves.toMatchObject({
      status: "valid",
      state: { version: "1.0.2" }
    });
  });
});

async function createStaging(stagingRoot: string, version: string): Promise<void> {
  const packageRoot = join(stagingRoot, "package");
  const skillRoot = join(packageRoot, "skills", "investment-research");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "# investment-research\n", "utf8");
  const sha256 = await managedPackageTreeSha256(skillRoot);
  const skills = [{ name: "investment-research", sha256 }];
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "@pi67/managed-ai-berkshire-investment-suite",
    version,
    private: true,
    pi: { skills: ["skills/investment-research"] }
  }), "utf8");
  await writeManagedSkillPackState(stagingRoot, {
    id: PACK_ID,
    version,
    upstream: "https://github.com/xbtlin/ai-berkshire",
    sourceCommit: "6".repeat(40),
    registryCommit: "7".repeat(40),
    manifestSha256: "8".repeat(64),
    bundleSha256: hashManagedSkillSet(skills),
    skills
  }, () => 1_722_400_000_000);
}
