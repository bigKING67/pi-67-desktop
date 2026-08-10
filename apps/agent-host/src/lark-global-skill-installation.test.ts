import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { beginGlobalLarkSkillInstallation } from "./lark-global-skill-installation.js";
import { globalAgentSkillsRoot } from "./lark-cli-resolution.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

const SKILL_IDS = ["lark-doc", "lark-im"];

describe("global Lark Skill installation", () => {
  it("installs only missing Skills, merges the global lock, and rolls back", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi67-global-lark-skills-"));
    const skillsRoot = globalAgentSkillsRoot(homeDirectory);
    await mkdir(join(skillsRoot, "lark-doc"), { recursive: true });
    await writeFile(join(skillsRoot, "lark-doc", "SKILL.md"), "existing", "utf8");
    const originalLock = {
      version: 3,
      skills: {
        "design-craft": { source: "sixseven/design-craft" },
        "lark-doc": { source: "user-existing" }
      },
      dismissed: { legacy: true }
    };
    await writeFile(
      join(homeDirectory, ".agents", ".skill-lock.json"),
      JSON.stringify(originalLock),
      "utf8"
    );

    const swap = await beginGlobalLarkSkillInstallation({
      homeDirectory,
      skillIds: SKILL_IDS,
      nodeExecutable: "/toolchain/node",
      npmCli: "/toolchain/npm-cli.js",
      gitExecPath: "/toolchain/git-core",
      environment: { PATH: "/usr/bin:/bin" },
      runProcess: stagedSkillsRunner(SKILL_IDS)
    });

    expect(swap.changed).toBe(true);
    await expect(readFile(join(skillsRoot, "lark-doc", "SKILL.md"), "utf8")).resolves.toBe("existing");
    await expect(access(join(skillsRoot, "lark-im", "SKILL.md"))).resolves.toBeUndefined();
    const installedLock = JSON.parse(
      await readFile(join(homeDirectory, ".agents", ".skill-lock.json"), "utf8")
    ) as { skills: Record<string, { source: string }>; dismissed: Record<string, unknown> };
    expect(installedLock.skills["design-craft"]?.source).toBe("sixseven/design-craft");
    expect(installedLock.skills["lark-doc"]?.source).toBe("user-existing");
    expect(installedLock.skills["lark-im"]?.source).toBe("larksuite/cli");
    expect(installedLock.dismissed).toEqual({ legacy: true });

    await swap.rollback();
    await expect(access(join(skillsRoot, "lark-im"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(homeDirectory, ".agents", ".skill-lock.json"), "utf8"))
      .resolves.toBe(JSON.stringify(originalLock));
  });

  it("commits validated global Skills under the standard shared directory", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi67-global-lark-skills-"));
    const swap = await beginGlobalLarkSkillInstallation({
      homeDirectory,
      skillIds: SKILL_IDS,
      nodeExecutable: "/toolchain/node",
      npmCli: "/toolchain/npm-cli.js",
      gitExecPath: "/toolchain/git-core",
      environment: { PATH: "/usr/bin:/bin" },
      runProcess: stagedSkillsRunner(SKILL_IDS)
    });

    await swap.commit();
    await expect(access(join(globalAgentSkillsRoot(homeDirectory), "lark-doc", "SKILL.md")))
      .resolves.toBeUndefined();
    await expect(access(join(globalAgentSkillsRoot(homeDirectory), "lark-im", "SKILL.md")))
      .resolves.toBeUndefined();
  });

  it("rejects an unexpected upstream Skill without changing the user directory", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi67-global-lark-skills-"));
    await expect(beginGlobalLarkSkillInstallation({
      homeDirectory,
      skillIds: SKILL_IDS,
      nodeExecutable: "/toolchain/node",
      npmCli: "/toolchain/npm-cli.js",
      gitExecPath: "/toolchain/git-core",
      environment: { PATH: "/usr/bin:/bin" },
      runProcess: stagedSkillsRunner([...SKILL_IDS, "lark-unexpected"])
    })).rejects.toThrow("验证清单不一致");
    await expect(access(globalAgentSkillsRoot(homeDirectory))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces only previously managed global Skills and restores their exact contents on rollback", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi67-global-lark-skills-"));
    const skillsRoot = globalAgentSkillsRoot(homeDirectory);
    const skills: Record<string, unknown> = {};
    for (const skillId of SKILL_IDS) {
      await mkdir(join(skillsRoot, skillId), { recursive: true });
      await writeFile(join(skillsRoot, skillId, "SKILL.md"), `old-${skillId}`, "utf8");
      skills[skillId] = { source: "larksuite/cli", skillPath: `skills/${skillId}/SKILL.md` };
    }
    const originalLock = { version: 3, skills, dismissed: { retained: true } };
    await writeFile(
      join(homeDirectory, ".agents", ".skill-lock.json"),
      JSON.stringify(originalLock),
      "utf8"
    );

    const swap = await beginGlobalLarkSkillInstallation({
      homeDirectory,
      skillIds: SKILL_IDS,
      nodeExecutable: "/toolchain/node",
      npmCli: "/toolchain/npm-cli.js",
      gitExecPath: "/toolchain/git-core",
      environment: { PATH: "/usr/bin:/bin" },
      runProcess: stagedSkillsRunner(SKILL_IDS),
      strategy: "replace-managed"
    });

    await expect(readFile(join(skillsRoot, "lark-doc", "SKILL.md"), "utf8"))
      .resolves.toContain("name: lark-doc");
    await swap.rollback();
    await expect(readFile(join(skillsRoot, "lark-doc", "SKILL.md"), "utf8"))
      .resolves.toBe("old-lark-doc");
    await expect(readFile(join(homeDirectory, ".agents", ".skill-lock.json"), "utf8"))
      .resolves.toBe(JSON.stringify(originalLock));
  });

  it("refuses to overwrite an existing Lark Skill not owned by the verified global source", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi67-global-lark-skills-"));
    const skillsRoot = globalAgentSkillsRoot(homeDirectory);
    for (const skillId of SKILL_IDS) {
      await mkdir(join(skillsRoot, skillId), { recursive: true });
      await writeFile(join(skillsRoot, skillId, "SKILL.md"), `user-${skillId}`, "utf8");
    }
    await writeFile(join(homeDirectory, ".agents", ".skill-lock.json"), JSON.stringify({
      version: 3,
      skills: {
        "lark-doc": { source: "user/local" },
        "lark-im": { source: "larksuite/cli" }
      },
      dismissed: {}
    }), "utf8");

    await expect(beginGlobalLarkSkillInstallation({
      homeDirectory,
      skillIds: SKILL_IDS,
      nodeExecutable: "/toolchain/node",
      npmCli: "/toolchain/npm-cli.js",
      gitExecPath: "/toolchain/git-core",
      environment: { PATH: "/usr/bin:/bin" },
      runProcess: stagedSkillsRunner(SKILL_IDS),
      strategy: "replace-managed"
    })).rejects.toThrow("未覆盖现有内容");
    await expect(readFile(join(skillsRoot, "lark-doc", "SKILL.md"), "utf8"))
      .resolves.toBe("user-lark-doc");
  });
});

function stagedSkillsRunner(
  stagedSkillIds: string[]
): ReturnType<typeof vi.fn<SkillPackProcessRunner>> {
  return vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
    expect(arguments_).toEqual(expect.arrayContaining([
      "exec",
      "--package=skills@1.5.22",
      "skills",
      "add",
      "larksuite/cli",
      "-g"
    ]));
    const stagingHome = options.environment.HOME!;
    const skillsRoot = join(stagingHome, ".agents", "skills");
    await mkdir(skillsRoot, { recursive: true });
    const skills: Record<string, unknown> = {};
    for (const skillId of stagedSkillIds) {
      await mkdir(join(skillsRoot, skillId), { recursive: true });
      await writeFile(join(skillsRoot, skillId, "SKILL.md"), `---\nname: ${skillId}\n---\n`, "utf8");
      skills[skillId] = {
        source: "larksuite/cli",
        sourceType: "github",
        skillPath: `skills/${skillId}/SKILL.md`
      };
    }
    await writeFile(join(stagingHome, ".agents", ".skill-lock.json"), JSON.stringify({
      version: 3,
      skills,
      dismissed: {}
    }), "utf8");
    return { stdout: "installed", stderr: "" };
  });
}
