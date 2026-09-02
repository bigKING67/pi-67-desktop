import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import {
  SkillPackManagement,
  type SkillPackManagementOptions
} from "./skill-pack-management.js";
import {
  hashManagedSkillSet,
  managedPackageTreeSha256,
  writeManagedSkillPackState
} from "./managed-skill-pack-state.js";

export function createManagement(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: {
    runProcess: NonNullable<SkillPackManagementOptions["runProcess"]>;
    installLarkCli?: NonNullable<SkillPackManagementOptions["installLarkCli"]>;
  }
) {
  return new SkillPackManagement(fixture.services, {
    capabilitiesRoot: fixture.capabilitiesRoot,
    homeDirectory: fixture.homeDirectory,
    now: () => 1_722_400_000_000,
    resolveLarkCli: async () => "/mock/lark-cli",
    runProcess: options.runProcess,
    ...(options.installLarkCli ? { installLarkCli: options.installLarkCli } : {})
  });
}

export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-skill-pack-"));
  const capabilitiesRoot = join(root, "capabilities");
  const homeDirectory = join(root, "home");
  const agentDir = join(homeDirectory, ".pi", "agent");
  await mkdir(capabilitiesRoot, { recursive: true });
  await mkdir(join(homeDirectory, ".agents", "skills", "lark-doc"), { recursive: true });
  await mkdir(join(homeDirectory, ".agents", "skills", "lark-calendar"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
    schema: "pi67.capability-catalog.v1",
    bundledSkillSuites: [{
      id: "lark-cli",
      displayName: "飞书 Lark CLI",
      description: "飞书文档、消息、日历和开放平台能力。",
      members: [
        { packageId: "pi-workspace-resources", skillId: "lark-doc" },
        { packageId: "pi-workspace-resources", skillId: "lark-calendar" }
      ]
    }, {
      id: "ai-berkshire-investment-suite",
      displayName: "AI Berkshire 投资研究",
      description: "公司研究、财务分析和组合管理能力。",
      bundledVersion: "1.0.1",
      upstream: "https://github.com/xbtlin/ai-berkshire",
      sourceCommit: "6".repeat(40),
      members: [
        { packageId: "pi-workspace-resources", skillId: "investment-research" },
        { packageId: "pi-workspace-resources", skillId: "portfolio-review" }
      ]
    }]
  }), "utf8");
  const services = {
    cwd: root,
    agentDir,
    settingsManager: { getShellPath: () => "/bin/zsh" }
  } as unknown as PiWorkspaceRuntimeServices;
  return { root, capabilitiesRoot, homeDirectory, services };
}

export async function aiRelease(root: string, version: string) {
  const skillRoot = join(root, "release-skill");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "# investment-research\n", "utf8");
  const skills = [{
    name: "investment-research",
    sha256: await managedPackageTreeSha256(skillRoot)
  }];
  return {
    id: "ai-berkshire-investment-suite" as const,
    version,
    upstream: "https://github.com/xbtlin/ai-berkshire",
    sourceCommit: "6".repeat(40),
    registryCommit: "7".repeat(40),
    manifestSha256: "8".repeat(64),
    bundleSha256: hashManagedSkillSet(skills),
    skills,
    independentlyInstallable: true
  };
}

export async function createAiStaging(
  stagingSuiteRoot: string,
  release: Awaited<ReturnType<typeof aiRelease>>
): Promise<void> {
  const skillRoot = join(stagingSuiteRoot, "package", "skills", "investment-research");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "# investment-research\n", "utf8");
  await writeFile(join(stagingSuiteRoot, "package", "package.json"), JSON.stringify({
    name: "@pi67/managed-ai-berkshire-investment-suite",
    version: release.version,
    private: true,
    pi: { skills: ["skills/investment-research"] }
  }), "utf8");
  await writeManagedSkillPackState(stagingSuiteRoot, {
    id: release.id,
    version: release.version,
    upstream: release.upstream,
    sourceCommit: release.sourceCommit,
    registryCommit: release.registryCommit,
    manifestSha256: release.manifestSha256,
    bundleSha256: release.bundleSha256,
    skills: release.skills
  }, () => 1_722_400_000_000);
}
