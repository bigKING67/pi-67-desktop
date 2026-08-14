import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { hashManagedSkillSet, managedPackageTreeSha256 } from "./managed-skill-pack-state.js";
import { Pi67SkillPackChannel } from "./pi67-skill-pack-channel.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

export const COMMIT = "7".repeat(40);

export interface RegistryFixture {
  root: string;
  repositoryRoot: string;
  toolchainRoot: string;
  gitExecutable: string;
  skills: Array<{ name: string; sha256: string }>;
}

export async function createRegistryFixture(): Promise<RegistryFixture> {
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

export function registryCheckChannel(fixture: RegistryFixture): Pi67SkillPackChannel {
  return channelWithRunner(fixture, registryRunner(fixture), undefined, "registry-check");
}

export function registryRunner(
  fixture: RegistryFixture,
  hooks: {
    onLsRemote?: (url: string) => string;
    onRemoteAdd?: (url: string) => void;
    onFetch?: (url: string) => void;
  } = {}
) {
  const remotes = new Map<string, string>();
  return vi.fn<SkillPackProcessRunner>(async (_executable, arguments_) => {
    if (arguments_[0] === "ls-remote") {
      return {
        stdout: hooks.onLsRemote?.(arguments_[1]!) ?? `${COMMIT}\trefs/heads/main\n`,
        stderr: ""
      };
    }
    const repositoryIndex = arguments_.indexOf("-C") + 1;
    const repositoryRoot = repositoryIndex > 0 ? arguments_[repositoryIndex] : arguments_[1];
    if (arguments_.includes("remote") && arguments_.includes("add")) {
      remotes.set(repositoryRoot!, arguments_.at(-1)!);
      hooks.onRemoteAdd?.(arguments_.at(-1)!);
    }
    if (arguments_.includes("fetch")) hooks.onFetch?.(remotes.get(repositoryRoot!)!);
    if (arguments_.includes("checkout")) await cp(fixture.repositoryRoot, repositoryRoot!, { recursive: true });
    if (arguments_.includes("rev-parse")) return { stdout: `${COMMIT}\n`, stderr: "" };
    if (arguments_[0] === "init") await mkdir(arguments_[1]!, { recursive: true });
    return { stdout: "", stderr: "" };
  });
}

export function channelWithRunner(
  fixture: RegistryFixture,
  runProcess: SkillPackProcessRunner,
  settingsPath: string | undefined,
  token: string
): Pi67SkillPackChannel {
  return new Pi67SkillPackChannel({
    environment: {
      PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
      PI67_GIT_EXECUTABLE: fixture.gitExecutable,
      ...(settingsPath ? { PI67_PACKAGE_NETWORK_SETTINGS: settingsPath } : {})
    },
    runProcess,
    createToken: () => token
  });
}
