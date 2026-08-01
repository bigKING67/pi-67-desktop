import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  hashManagedSkillSet,
  inspectManagedSkillPack,
  managedPackageTreeSha256
} from "./managed-skill-pack-state.js";
import { Pi67SkillPackChannel, compareSkillPackVersions } from "./pi67-skill-pack-channel.js";

const COMMIT = "7".repeat(40);

describe("Pi-67 Skill Pack registry channel", () => {
  it("binds raw metadata to an exact registry commit and stages only verified Skill directories", async () => {
    const fixture = await createRegistryFixture();
    const runProcess = vi.fn(async (_executable: string, arguments_: string[]) => {
      if (arguments_[0] === "ls-remote") {
        return { stdout: `${COMMIT}\trefs/heads/main\n`, stderr: "" };
      }
      const repositoryIndex = arguments_.indexOf("-C") + 1;
      const repositoryRoot = repositoryIndex > 0 ? arguments_[repositoryIndex] : arguments_[1];
      if (arguments_.includes("checkout")) await cp(fixture.repositoryRoot, repositoryRoot!, { recursive: true });
      if (arguments_.includes("rev-parse")) return { stdout: `${COMMIT}\n`, stderr: "" };
      if (arguments_[0] === "init") await mkdir(arguments_[1]!, { recursive: true });
      return { stdout: "", stderr: "" };
    });
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const path = requestedUrl.endsWith("shared-skill-packs.lock.json")
        ? join(fixture.repositoryRoot, "shared-skill-packs.lock.json")
        : join(fixture.repositoryRoot, "shared-skill-packs.json");
      return new Response(await readFile(path), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof globalThis.fetch;
    const channel = new Pi67SkillPackChannel({
      environment: {
        PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
        PI67_GIT_EXECUTABLE: fixture.gitExecutable
      },
      repository: "https://github.com/bigKING67/pi-67.git",
      rawRoot: "https://raw.githubusercontent.invalid/bigKING67/pi-67",
      fetch,
      runProcess,
      createToken: () => "fixture",
      now: () => 1_722_400_000_000
    });

    await expect(channel.check()).resolves.toMatchObject({
      version: "1.0.2",
      registryCommit: COMMIT,
      independentlyInstallable: true
    });
    const agentDir = join(fixture.root, "agent");
    const staged = await channel.stage(agentDir);
    expect(staged.release.skills.map((skill) => skill.name)).toEqual([
      "investment-research",
      "portfolio-review"
    ]);
    const stagedInspection = await inspectStaged(agentDir, staged.stagingSuiteRoot);
    expect(stagedInspection).toMatchObject({ status: "valid", state: { version: "1.0.2" } });
    expect(runProcess).toHaveBeenCalledWith(
      fixture.gitExecutable,
      expect.arrayContaining(["fetch", "--depth", "1", "--no-tags", "origin", COMMIT]),
      expect.objectContaining({ timeoutMs: 300_000 })
    );
  });

  it("rejects a Git executable outside the private toolchain root before spawning it", async () => {
    const fixture = await createRegistryFixture();
    const outsideGit = join(fixture.root, "outside-git");
    await writeFile(outsideGit, "not git\n", "utf8");
    const runProcess = vi.fn();
    const channel = new Pi67SkillPackChannel({
      environment: {
        PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
        PI67_GIT_EXECUTABLE: outsideGit
      },
      runProcess
    });

    await expect(channel.check()).rejects.toThrow("私有 Git 工具链不可用");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("rejects a directory in place of the private Git executable", async () => {
    const fixture = await createRegistryFixture();
    const runProcess = vi.fn();
    const channel = new Pi67SkillPackChannel({
      environment: {
        PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
        PI67_GIT_EXECUTABLE: join(fixture.toolchainRoot, "git")
      },
      runProcess
    });

    await expect(channel.check()).rejects.toThrow("私有 Git 工具链不可用");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("accepts the exact legacy bundled-only registry shape without making it installable", async () => {
    const fixture = await createRegistryFixture();
    await writeFile(join(fixture.repositoryRoot, "shared-skill-packs.json"), JSON.stringify({
      schema: "pi67.shared-skill-packs.v1",
      packs: [{
        name: "ai-berkshire-investment-suite",
        version: "1.0.0",
        owner: "pi67-first-party",
        distribution: "bundled-release-only",
        skills: fixture.skills.map((skill) => skill.name)
      }]
    }), "utf8");
    await writeFile(join(fixture.repositoryRoot, "shared-skill-packs.lock.json"), JSON.stringify({
      schema: "pi67.shared-skill-packs-lock.v1",
      packs: [{
        name: "ai-berkshire-investment-suite",
        version: "1.0.0",
        upstream: "",
        source_commit: "6".repeat(40),
        manifest_sha256: "8".repeat(64),
        bundle_sha256: hashManagedSkillSet(fixture.skills),
        skills: fixture.skills
      }]
    }), "utf8");
    const channel = registryCheckChannel(fixture);

    const release = await channel.check();
    expect(release).toMatchObject({ version: "1.0.0", independentlyInstallable: false });
    expect(release).not.toHaveProperty("upstream");
    await expect(channel.stage(join(fixture.root, "agent")))
      .rejects.toThrow("尚未开放此 Skill Pack 的独立安装");
  });

  it("still rejects an independently installable registry entry without a verified HTTPS upstream", async () => {
    const fixture = await createRegistryFixture();
    await writeFile(join(fixture.repositoryRoot, "shared-skill-packs.json"), JSON.stringify({
      schema: "pi67.shared-skill-packs.v1",
      packs: [{
        name: "ai-berkshire-investment-suite",
        version: "1.0.2",
        skills: fixture.skills.map((skill) => skill.name)
      }]
    }), "utf8");
    await writeFile(join(fixture.repositoryRoot, "shared-skill-packs.lock.json"), JSON.stringify({
      schema: "pi67.shared-skill-packs-lock.v1",
      packs: [{
        name: "ai-berkshire-investment-suite",
        version: "1.0.2",
        upstream: "",
        source_commit: "6".repeat(40),
        manifest_sha256: "8".repeat(64),
        bundle_sha256: hashManagedSkillSet(fixture.skills),
        skills: fixture.skills
      }]
    }), "utf8");

    await expect(registryCheckChannel(fixture).check()).rejects.toThrow("元数据不一致");
  });

  it("uses numeric semantic-version ordering", () => {
    expect(compareSkillPackVersions("1.0.10", "1.0.2")).toBe(1);
    expect(compareSkillPackVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareSkillPackVersions("1.9.9", "2.0.0")).toBe(-1);
  });
});

async function inspectStaged(agentDir: string, stagingSuiteRoot: string) {
  const stableRoot = join(agentDir, "desktop-capabilities", "skill-packs", "ai-berkshire-investment-suite");
  await mkdir(join(stableRoot, ".."), { recursive: true });
  await cp(stagingSuiteRoot, stableRoot, { recursive: true });
  return inspectManagedSkillPack(agentDir, "ai-berkshire-investment-suite");
}

async function createRegistryFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-registry-channel-"));
  const repositoryRoot = join(root, "repository");
  const toolchainRoot = join(root, "toolchain");
  const gitExecutable = join(toolchainRoot, "git", "bin", "git");
  await mkdir(join(toolchainRoot, "git", "bin"), { recursive: true });
  await writeFile(gitExecutable, "not executed by fixture\n", "utf8");
  const skillNames = ["investment-research", "portfolio-review"];
  const skills: Array<{ name: string; sha256: string }> = [];
  for (const name of skillNames) {
    const skillRoot = join(repositoryRoot, "shared-skills", name);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `# ${name}\n`, "utf8");
    skills.push({ name, sha256: await managedPackageTreeSha256(skillRoot) });
  }
  await writeFile(join(repositoryRoot, "shared-skill-packs.json"), JSON.stringify({
    schema: "pi67.shared-skill-packs.v1",
    packs: [{
      name: "ai-berkshire-investment-suite",
      version: "1.0.2",
      upstream: "https://github.com/xbtlin/ai-berkshire",
      skills: skillNames
    }]
  }), "utf8");
  await writeFile(join(repositoryRoot, "shared-skill-packs.lock.json"), JSON.stringify({
    schema: "pi67.shared-skill-packs-lock.v1",
    packs: [{
      name: "ai-berkshire-investment-suite",
      version: "1.0.2",
      upstream: "https://github.com/xbtlin/ai-berkshire",
      source_commit: "6".repeat(40),
      manifest_sha256: "8".repeat(64),
      bundle_sha256: hashManagedSkillSet(skills),
      skills
    }]
  }), "utf8");
  return { root, repositoryRoot, toolchainRoot, gitExecutable, skills };
}

function registryCheckChannel(fixture: Awaited<ReturnType<typeof createRegistryFixture>>) {
  const runProcess = vi.fn(async (_executable: string, arguments_: string[]) => {
    if (arguments_[0] === "ls-remote") {
      return { stdout: `${COMMIT}\trefs/heads/main\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const requestedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const path = requestedUrl.endsWith("shared-skill-packs.lock.json")
      ? join(fixture.repositoryRoot, "shared-skill-packs.lock.json")
      : join(fixture.repositoryRoot, "shared-skill-packs.json");
    return new Response(await readFile(path), { status: 200 });
  }) as typeof globalThis.fetch;
  return new Pi67SkillPackChannel({
    environment: {
      PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
      PI67_GIT_EXECUTABLE: fixture.gitExecutable
    },
    fetch,
    runProcess
  });
}
