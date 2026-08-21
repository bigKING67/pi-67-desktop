import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  beginDesktopLarkCliInstallation
} from "./lark-cli-installation.js";
import {
  desktopManagedLarkCliRoot,
  globalAgentSkillsRoot,
  userGlobalLarkCliLauncher
} from "./lark-cli-resolution.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

const SKILL_IDS = ["lark-doc", "lark-im"];
const NPM_REGISTRY = "https://registry.npmjs.org";

describe("Desktop-managed Lark CLI installation", () => {
  it("stages, verifies, activates, and rolls back without exposing private toolchain secrets", async () => {
    const fixture = await installationFixture();
    const runProcess = installerRunner("1.0.85");

    const swap = await beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      selectNpmRegistry: async () => NPM_REGISTRY
    });

    expect(swap.version).toBe("1.0.85");
    await expect(access(swap.executable)).resolves.toBeUndefined();
    const installEnvironment = runProcess.mock.calls[0]?.[2].environment;
    expect(installEnvironment).toMatchObject({
      PI67_ELECTRON_EXECUTABLE: fixture.environment.PI67_ELECTRON_EXECUTABLE,
      PI67_WINDOWS_JOB_CONTROLLER: fixture.environment.PI67_WINDOWS_JOB_CONTROLLER
    });
    expect(installEnvironment).not.toHaveProperty("PROVIDER_API_KEY");
    expect(installEnvironment).not.toHaveProperty("SCIENCETOKEN_API_KEY");
    expect(runProcess.mock.calls.map(([, arguments_]) => arguments_)).toEqual([
      expect.arrayContaining(["install", "--registry", NPM_REGISTRY, "@larksuite/cli@latest"]),
      [expect.stringMatching(/scripts[/\\\\]install\.js$/u)],
      ["--version"],
      ["update", "--check", "--json"],
      expect.arrayContaining([
        "skills",
        "add",
        "https://open.feishu.cn/lark-cli/skills/regular",
        "-g"
      ])
    ]);
    expect(runProcess.mock.calls[0]?.[1]).toContain("--ignore-scripts");
    expect(runProcess.mock.calls[0]?.[1]).not.toContain("--ignore-scripts=false");
    expect(runProcess.mock.calls[1]?.[2].environment).not.toHaveProperty("PROVIDER_API_KEY");
    expect(runProcess.mock.calls[1]?.[2].environment).not.toHaveProperty("SCIENCETOKEN_API_KEY");
    await expect(access(join(globalAgentSkillsRoot(fixture.homeDirectory), "lark-doc"))).resolves.toBeUndefined();
    await expect(access(userGlobalLarkCliLauncher(
      fixture.homeDirectory,
      fixture.environment
    ))).resolves.toBeUndefined();

    await swap.rollback();
    await expect(access(desktopManagedLarkCliRoot(fixture.homeDirectory))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(globalAgentSkillsRoot(fixture.homeDirectory), "lark-doc")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores the previous installation when the transaction rolls back", async () => {
    const fixture = await installationFixture();
    const stableRoot = desktopManagedLarkCliRoot(fixture.homeDirectory);
    await mkdir(stableRoot, { recursive: true });
    await writeFile(join(stableRoot, "previous.txt"), "previous", "utf8");

    const swap = await beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess: installerRunner("1.0.85"),
      selectNpmRegistry: async () => NPM_REGISTRY
    });
    await swap.rollback();

    await expect(readFile(join(stableRoot, "previous.txt"), "utf8")).resolves.toBe("previous");
  });

  it("keeps the previous installation when staged package validation fails", async () => {
    const fixture = await installationFixture();
    const stableRoot = desktopManagedLarkCliRoot(fixture.homeDirectory);
    await mkdir(stableRoot, { recursive: true });
    await writeFile(join(stableRoot, "previous.txt"), "previous", "utf8");
    const runProcess = installerRunner("1.0.85", "@example/not-lark");

    await expect(beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      selectNpmRegistry: async () => NPM_REGISTRY
    })).rejects.toMatchObject({ stage: "validation" });
    await expect(readFile(join(stableRoot, "previous.txt"), "utf8")).resolves.toBe("previous");
    expect(runProcess).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a conflicting user launcher and rolls back newly activated global Skills", async () => {
    const fixture = await installationFixture();
    const launcher = userGlobalLarkCliLauncher(fixture.homeDirectory, fixture.environment);
    await mkdir(dirname(launcher), { recursive: true });
    await writeFile(launcher, "user-launcher", { mode: 0o755 });

    await expect(beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess: installerRunner("1.0.85"),
      selectNpmRegistry: async () => NPM_REGISTRY
    })).rejects.toMatchObject({ stage: "activation" });

    await expect(readFile(launcher, "utf8")).resolves.toBe("user-launcher");
    await expect(access(join(globalAgentSkillsRoot(fixture.homeDirectory), "lark-doc")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs the exact checked update target through the selected registry", async () => {
    const fixture = await installationFixture();
    const runProcess = installerRunner("1.0.88");

    const swap = await beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      operation: "update",
      targetVersion: "1.0.88",
      minimumVersion: "1.0.57",
      selectNpmRegistry: async () => NPM_REGISTRY
    });

    expect(runProcess.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      "--registry",
      NPM_REGISTRY,
      "@larksuite/cli@1.0.88"
    ]));
    await swap.rollback();
  });

  it("keeps a validated CLI active when optional official Skills synchronization fails", async () => {
    const fixture = await installationFixture();
    const stableRoot = desktopManagedLarkCliRoot(fixture.homeDirectory);
    await mkdir(stableRoot, { recursive: true });
    await writeFile(join(stableRoot, "previous.txt"), "previous", "utf8");
    const baseRunner = installerRunner("1.0.88");
    const runProcess = vi.fn<SkillPackProcessRunner>(async (...arguments_) => {
      const processArguments = arguments_[1];
      if (processArguments.includes("skills") && processArguments.includes("add")) {
        throw new Error("skills source unavailable");
      }
      return baseRunner(...arguments_);
    });

    const swap = await beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      operation: "update",
      targetVersion: "1.0.88",
      minimumVersion: "1.0.57",
      selectNpmRegistry: async () => NPM_REGISTRY
    });

    expect(swap).toMatchObject({
      version: "1.0.88",
      skills: {
        state: "pending",
        detail: expect.stringContaining("无需重新下载 CLI")
      }
    });
    await expect(access(swap.executable)).resolves.toBeUndefined();
    await expect(access(join(stableRoot, "previous.txt"))).rejects.toMatchObject({ code: "ENOENT" });

    await swap.rollback();
    await expect(readFile(join(stableRoot, "previous.txt"), "utf8")).resolves.toBe("previous");
  });

  it("rejects a staged version mismatch before running package code", async () => {
    const fixture = await installationFixture();
    const runProcess = installerRunner("1.0.87");

    await expect(beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      operation: "update",
      targetVersion: "1.0.88",
      minimumVersion: "1.0.57",
      selectNpmRegistry: async () => NPM_REGISTRY
    })).rejects.toMatchObject({ stage: "validation" });
    expect(runProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects a channel downgrade before using the network", async () => {
    const fixture = await installationFixture();
    const runProcess = installerRunner("1.0.87");
    const selectNpmRegistry = vi.fn(async () => NPM_REGISTRY);

    await expect(beginDesktopLarkCliInstallation({
      homeDirectory: fixture.homeDirectory,
      skillIds: SKILL_IDS,
      environment: fixture.environment,
      runProcess,
      operation: "update",
      targetVersion: "1.0.87",
      minimumVersion: "1.0.88",
      selectNpmRegistry
    })).rejects.toMatchObject({
      stage: "validation",
      message: expect.stringContaining("拒绝降级")
    });
    expect(selectNpmRegistry).not.toHaveBeenCalled();
    expect(runProcess).not.toHaveBeenCalled();
  });
});

async function installationFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-lark-cli-install-"));
  const homeDirectory = join(root, "home");
  const toolchainRoot = join(root, "toolchain");
  const nodeExecutable = join(toolchainRoot, "node", "bin", process.platform === "win32" ? "node.exe" : "node");
  const npmCli = join(toolchainRoot, "npm", "bin", "npm-cli.js");
  await mkdir(homeDirectory, { recursive: true });
  return {
    homeDirectory,
    environment: {
      PI67_DESKTOP: "1",
      PI67_PACKAGED: "1",
      PI67_TOOLCHAIN_ROOT: toolchainRoot,
      PI67_NODE_EXECUTABLE: nodeExecutable,
      PI67_NPM_CLI: npmCli,
      PI67_GIT_EXECUTABLE: join(toolchainRoot, "git", "bin", process.platform === "win32" ? "git.exe" : "git"),
      PI67_GIT_EXEC_PATH: join(toolchainRoot, "git", "libexec", "git-core"),
      PI67_ELECTRON_EXECUTABLE: join(root, "Pi-67 Desktop.exe"),
      PI67_WINDOWS_JOB_CONTROLLER: join(toolchainRoot, "pi67-package-worker-job.exe"),
      PATH: "/usr/bin:/bin",
      PROVIDER_API_KEY: "provider-secret",
      SCIENCETOKEN_API_KEY: "company-secret"
    } satisfies NodeJS.ProcessEnv
  };
}

function installerRunner(
  version: string,
  packageName = "@larksuite/cli"
): ReturnType<typeof vi.fn<SkillPackProcessRunner>> {
  return vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
    if (arguments_.includes("install")) {
      const prefixIndex = arguments_.indexOf("--prefix");
      const stagingRoot = arguments_[prefixIndex + 1]!;
      const packageRoot = join(stagingRoot, "node_modules", "@larksuite", "cli");
      await mkdir(join(packageRoot, "scripts"), { recursive: true });
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: packageName,
        version
      }), "utf8");
      await writeFile(join(packageRoot, "scripts", "install.js"), "// fixture", "utf8");
      return { stdout: "downloaded", stderr: "" };
    }
    if (arguments_[0]?.endsWith(join("scripts", "install.js"))) {
      const packageRoot = join(arguments_[0], "..", "..");
      const executable = join(packageRoot, "bin", process.platform === "win32" ? "lark-cli.exe" : "lark-cli");
      await mkdir(join(packageRoot, "bin"), { recursive: true });
      await writeFile(executable, "fixture", { mode: 0o755 });
      return { stdout: "installed", stderr: "" };
    }
    if (arguments_[0] === "--version") {
      return { stdout: `lark-cli version ${version}\n`, stderr: "" };
    }
    if (arguments_.includes("skills") && arguments_.includes("add")) {
      const skillsRoot = join(options.environment.HOME!, ".agents", "skills");
      await mkdir(skillsRoot, { recursive: true });
      const skills: Record<string, unknown> = {};
      for (const skillId of SKILL_IDS) {
        await mkdir(join(skillsRoot, skillId), { recursive: true });
        await writeFile(join(skillsRoot, skillId, "SKILL.md"), `---\nname: ${skillId}\n---\n`, "utf8");
        skills[skillId] = { source: "larksuite/cli", skillPath: `skills/${skillId}/SKILL.md` };
      }
      await writeFile(join(options.environment.HOME!, ".agents", ".skill-lock.json"), JSON.stringify({
        version: 3,
        skills,
        dismissed: {}
      }), "utf8");
      return { stdout: "skills installed", stderr: "" };
    }
    return {
      stdout: JSON.stringify({
        ok: true,
        action: "up_to_date",
        auto_update: true,
        current_version: version,
        latest_version: version,
        skills_status: { current: version, in_sync: true }
      }),
      stderr: ""
    };
  });
}
