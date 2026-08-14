import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hashManagedSkillSet, inspectManagedSkillPack } from "./managed-skill-pack-state.js";
import { Pi67SkillPackChannel, compareSkillPackVersions } from "./pi67-skill-pack-channel.js";
import {
  channelWithRunner,
  COMMIT,
  createRegistryFixture,
  registryCheckChannel,
  registryRunner
} from "./pi67-skill-pack-channel.test-support.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

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
    const channel = new Pi67SkillPackChannel({
      environment: {
        PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
        PI67_GIT_EXECUTABLE: fixture.gitExecutable
      },
      repository: "https://github.com/bigKING67/pi-67.git",
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

  it("falls back from a failed configured mirror to the official repository", async () => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, "network-settings.json");
    await writeFile(settingsPath, JSON.stringify({
      schema: "pi67.package-network.v1",
      settings: {
        npmMode: "automatic",
        gitMode: "automatic",
        gitMirrors: ["gitclone"]
      }
    }), "utf8");
    const attempted: string[] = [];
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, _options) => {
      if (arguments_[0] === "ls-remote") {
        attempted.push(arguments_[1]!);
        if (arguments_[1]!.includes("gitclone.com")) throw new Error("HTTP 502");
        return { stdout: `${COMMIT}\trefs/heads/main\n`, stderr: "" };
      }
      const repositoryIndex = arguments_.indexOf("-C") + 1;
      const repositoryRoot = repositoryIndex > 0 ? arguments_[repositoryIndex] : arguments_[1];
      if (arguments_.includes("checkout")) await cp(fixture.repositoryRoot, repositoryRoot!, { recursive: true });
      if (arguments_.includes("rev-parse")) return { stdout: `${COMMIT}\n`, stderr: "" };
      if (arguments_[0] === "init") await mkdir(arguments_[1]!, { recursive: true });
      return { stdout: "", stderr: "" };
    });
    const channel = new Pi67SkillPackChannel({
      environment: {
        PI67_TOOLCHAIN_ROOT: fixture.toolchainRoot,
        PI67_GIT_EXECUTABLE: fixture.gitExecutable,
        PI67_PACKAGE_NETWORK_SETTINGS: settingsPath,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "url.https://untrusted.invalid/.insteadOf",
        GIT_CONFIG_VALUE_0: "https://github.com/"
      },
      runProcess,
      createToken: () => "fallback"
    });

    await expect(channel.check()).resolves.toMatchObject({ registryCommit: COMMIT });
    expect(attempted).toEqual([
      "https://gitclone.com/github.com/bigKING67/pi-67.git",
      "https://github.com/bigKING67/pi-67.git"
    ]);
    expect(runProcess.mock.calls.every(([, , options]) => (
      options.environment.GIT_CONFIG_COUNT === "0"
      && options.environment.GIT_CONFIG_KEY_0 === undefined
      && options.environment.GIT_CONFIG_VALUE_0 === undefined
      && options.environment.GIT_CONFIG_GLOBAL === (process.platform === "win32" ? "NUL" : "/dev/null")
      && options.environment.GIT_CONFIG_NOSYSTEM === "1"
    ))).toBe(true);
  });

  it.each([
    ["official-only", [], ["https://github.com/bigKING67/pi-67.git"]],
    ["mirror-only", ["gitclone"], ["https://gitclone.com/github.com/bigKING67/pi-67.git"]]
  ] as const)("honors the %s Git source policy", async (gitMode, gitMirrors, expected) => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, `${gitMode}.json`);
    await writeFile(settingsPath, JSON.stringify({
      schema: "pi67.package-network.v1",
      settings: { npmMode: "automatic", gitMode, gitMirrors }
    }), "utf8");
    const attempted: string[] = [];
    const runProcess = registryRunner(fixture, {
      onLsRemote(url) {
        attempted.push(url);
        return `${COMMIT}\trefs/heads/main\n`;
      }
    });
    const channel = channelWithRunner(fixture, runProcess, settingsPath, `${gitMode}-policy`);

    await expect(channel.check()).resolves.toMatchObject({ registryCommit: COMMIT });
    expect(attempted).toEqual(expected);
  });

  it("keeps ordered custom, built-in mirror, and official candidates explicit", async () => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, "custom-order.json");
    await writeFile(settingsPath, JSON.stringify({
      schema: "pi67.package-network.v1",
      settings: {
        npmMode: "automatic",
        gitMode: "automatic",
        gitMirrors: ["ghproxy"],
        gitCustomMirrorPrefix: "https://mirror.example.test"
      }
    }), "utf8");
    const attempted: string[] = [];
    const runProcess = registryRunner(fixture, {
      onLsRemote(url) {
        attempted.push(url);
        if (!url.startsWith("https://github.com/")) throw new Error("transport unavailable");
        return `${COMMIT}\trefs/heads/main\n`;
      }
    });
    const channel = channelWithRunner(fixture, runProcess, settingsPath, "custom-order");

    await expect(channel.check()).resolves.toMatchObject({ registryCommit: COMMIT });
    expect(attempted).toEqual([
      "https://mirror.example.test/https://github.com/bigKING67/pi-67.git",
      "https://ghproxy.net/https://github.com/bigKING67/pi-67.git",
      "https://github.com/bigKING67/pi-67.git"
    ]);
  });

  it("bounds the aggregated error when every configured transport is unavailable", async () => {
    const fixture = await createRegistryFixture();
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_) => {
      if (arguments_[0] === "ls-remote") throw new Error(`transport unavailable ${"x".repeat(1_000)}`);
      return { stdout: "", stderr: "" };
    });
    const channel = channelWithRunner(fixture, runProcess, undefined, "all-unavailable");

    const error = await channel.check().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("registry 下载源均不可用");
    expect((error as Error).message.length).toBeLessThanOrEqual(843);
  });

  it("does not fall back after a mirror returns malformed branch identity", async () => {
    const fixture = await createRegistryFixture();
    const attempted: string[] = [];
    const runProcess = registryRunner(fixture, {
      onLsRemote(url) {
        attempted.push(url);
        return "not-a-commit\trefs/heads/main\n";
      }
    });
    const channel = channelWithRunner(fixture, runProcess, undefined, "invalid-branch");

    await expect(channel.check()).rejects.toThrow("branch 解析失败");
    expect(attempted).toHaveLength(1);
  });

  it("does not fall back after fetched registry metadata fails integrity validation", async () => {
    const fixture = await createRegistryFixture();
    await writeFile(join(fixture.repositoryRoot, "shared-skill-packs.json"), JSON.stringify({
      schema: "pi67.shared-skill-packs.invalid",
      packs: []
    }), "utf8");
    const attempted: string[] = [];
    const runProcess = registryRunner(fixture, {
      onLsRemote(url) {
        attempted.push(url);
        return `${COMMIT}\trefs/heads/main\n`;
      }
    });
    const channel = channelWithRunner(fixture, runProcess, undefined, "invalid-registry");

    await expect(channel.check()).rejects.toThrow("registry schema 无效");
    expect(attempted).toHaveLength(1);
  });

  it("uses the transport selected by check for the subsequent full stage", async () => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, "stage-transport.json");
    await writeFile(settingsPath, JSON.stringify({
      schema: "pi67.package-network.v1",
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] }
    }), "utf8");
    const remoteAddUrls: string[] = [];
    const runProcess = registryRunner(fixture, {
      onLsRemote(url) {
        if (url.includes("gitclone.com")) throw new Error("HTTP 502");
        return `${COMMIT}\trefs/heads/main\n`;
      },
      onRemoteAdd(url) {
        remoteAddUrls.push(url);
      }
    });
    const channel = channelWithRunner(fixture, runProcess, settingsPath, "winning-stage");

    await expect(channel.stage(join(fixture.root, "agent"))).resolves.toMatchObject({
      release: { registryCommit: COMMIT }
    });
    expect(remoteAddUrls.at(-1)).toBe("https://github.com/bigKING67/pi-67.git");
  });

  it("falls back when the selected mirror fails during the actual stage fetch", async () => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, "stage-fetch-fallback.json");
    await writeFile(settingsPath, JSON.stringify({
      schema: "pi67.package-network.v1",
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] }
    }), "utf8");
    const remoteAddUrls: string[] = [];
    const fetchCounts = new Map<string, number>();
    const runProcess = registryRunner(fixture, {
      onLsRemote: () => `${COMMIT}\trefs/heads/main\n`,
      onRemoteAdd(url) {
        remoteAddUrls.push(url);
      },
      onFetch(url) {
        const count = (fetchCounts.get(url) ?? 0) + 1;
        fetchCounts.set(url, count);
        if (url.includes("gitclone.com") && count > 1) throw new Error("HTTP 502");
      }
    });
    const channel = channelWithRunner(fixture, runProcess, settingsPath, "stage-fetch-fallback");

    await expect(channel.stage(join(fixture.root, "agent"))).resolves.toMatchObject({
      release: { registryCommit: COMMIT }
    });
    expect(remoteAddUrls).toContain("https://gitclone.com/github.com/bigKING67/pi-67.git");
    expect(remoteAddUrls.at(-1)).toBe("https://github.com/bigKING67/pi-67.git");
  });

  it("fails closed before spawning Git when persisted network settings are malformed", async () => {
    const fixture = await createRegistryFixture();
    const settingsPath = join(fixture.root, "invalid-network-settings.json");
    await writeFile(settingsPath, "{invalid-json", "utf8");
    const runProcess = vi.fn<SkillPackProcessRunner>();
    const channel = channelWithRunner(fixture, runProcess, settingsPath, "invalid-settings");

    await expect(channel.check()).rejects.toThrow("Package network settings are invalid");
    expect(runProcess).not.toHaveBeenCalled();
  });
});

async function inspectStaged(agentDir: string, stagingSuiteRoot: string) {
  const stableRoot = join(agentDir, "desktop-capabilities", "skill-packs", "ai-berkshire-investment-suite");
  await mkdir(join(stableRoot, ".."), { recursive: true });
  await cp(stagingSuiteRoot, stableRoot, { recursive: true });
  return inspectManagedSkillPack(agentDir, "ai-berkshire-investment-suite");
}
