import { mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SkillPackManagement,
  type SkillPackManagementOptions
} from "./skill-pack-management.js";
import {
  inspectManagedSkillPack,
  managedSkillPackRoot
} from "./managed-skill-pack-state.js";
import {
  aiRelease,
  createAiStaging,
  createFixture,
  createManagement,
  currentPi67Channel
} from "./skill-pack-management-test-support.js";

describe("SkillPackManagement", () => {
  it("discovers the explicit Lark suite and converts CLI update JSON into one Pack update", async () => {
    const fixture = await createFixture();
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "update_available",
        auto_update: true,
        current_version: "1.0.65",
        latest_version: "1.0.80",
        skills_status: { in_sync: true }
      }),
      stderr: ""
    }));
    const management = createManagement(fixture, { runProcess });

    const listed = await management.list();
    expect(listed.total).toBe(2);
    expect(listed.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
        id: "lark-cli-global",
        suiteId: "lark-cli",
        installedSkillCount: 2,
        skillIds: ["lark-doc", "lark-calendar"],
        updateStatus: "not-checked",
        canUpdate: false
    });
    const checked = await management.checkForUpdates();
    expect(checked).toMatchObject({ total: 2, checkedAt: 1_722_400_000_000 });
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
        installedVersion: "1.0.65",
        latestVersion: "1.0.80",
        updateStatus: "update-available",
        localState: "clean",
        canUpdate: true
    });
    expect(checked.items.find((item) => item.id === "ai-berkshire-investment-suite")).toMatchObject({
      installedVersion: "1.0.1",
      latestVersion: "1.0.1",
      updateStatus: "current",
      localState: "clean",
      canUpdate: false
    });
    expect(runProcess).toHaveBeenCalledWith(
      "/mock/lark-cli",
      ["update", "--check", "--json"],
      expect.objectContaining({ timeoutMs: 60_000 })
    );
  });

  it("distinguishes a newer bundled-only registry record from a failed check", async () => {
    const fixture = await createFixture();
    const release = {
      ...await aiRelease(fixture.root, "1.0.2"),
      independentlyInstallable: false
    };
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => undefined,
      pi67Channel: {
        check: vi.fn(async () => release),
        stage: vi.fn(async () => { throw new Error("unexpected stage"); })
      }
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === release.id)).toMatchObject({
      installedVersion: "1.0.1",
      latestVersion: "1.0.2",
      updateStatus: "application-managed",
      canUpdate: false,
      detail: "Pi-67 registry 已记录版本 1.0.2，但尚未开放独立安装；当前继续使用 1.0.1。"
    });
  });

  it("keeps a newer bundled baseline current when the registry record is older history", async () => {
    const fixture = await createFixture();
    const release = {
      ...await aiRelease(fixture.root, "1.0.0"),
      independentlyInstallable: false
    };
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => undefined,
      pi67Channel: {
        check: vi.fn(async () => release),
        stage: vi.fn(async () => { throw new Error("unexpected stage"); })
      }
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === release.id)).toMatchObject({
      installedVersion: "1.0.1",
      latestVersion: "1.0.0",
      updateStatus: "current",
      canUpdate: false,
      detail: "当前内置基线不低于 Pi-67 registry 可用版本。"
    });
  });

  it("blocks automatic overwrite when Lark reports official Skill drift", async () => {
    const fixture = await createFixture();
    const management = createManagement(fixture, {
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "update_available",
          auto_update: true,
          current_version: "1.0.65",
          latest_version: "1.0.80",
          skills_status: { in_sync: false }
        }),
        stderr: ""
      }))
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global"))
      .toMatchObject({ updateStatus: "modified", localState: "modified", canUpdate: false });
    await expect(management.beginUpdate("lark-cli-global"))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("keeps a complete latest official Skill set updateable when only the Lark CLI version is behind", async () => {
    const fixture = await createFixture();
    const management = createManagement(fixture, {
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "update_available",
          auto_update: true,
          current_version: "1.0.65",
          latest_version: "1.0.80",
          skills_status: {
            current: "1.0.80",
            in_sync: false,
            official: 27,
            target: "1.0.65",
            updated: 27
          }
        }),
        stderr: ""
      }))
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      installedVersion: "1.0.65",
      latestVersion: "1.0.80",
      updateStatus: "update-available",
      localState: "clean",
      canUpdate: true
    });
  });

  it("updates through the owning CLI, verifies convergence, and never exposes the executable path", async () => {
    const fixture = await createFixture();
    const executable = join(fixture.root, "canonical", "bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
    const privateNodeDirectory = join(fixture.root, "private-toolchain", "node", "bin");
    const environment: NodeJS.ProcessEnv = {
      PATH: [privateNodeDirectory, dirname(executable), "/usr/bin"].join(delimiter),
      PI67_NODE_EXECUTABLE: join(privateNodeDirectory, process.platform === "win32" ? "node.exe" : "node")
    };
    let checkCount = 0;
    const runProcess = vi.fn(async (
      _executable: string,
      arguments_: string[],
      _options: Parameters<NonNullable<SkillPackManagementOptions["runProcess"]>>[2]
    ) => {
      if (!arguments_.includes("--check")) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      checkCount += 1;
      return {
        stdout: JSON.stringify(checkCount === 1 ? {
          ok: true,
          action: "update_available",
          auto_update: true,
          current_version: "1.0.65",
          latest_version: "1.0.80",
          skills_status: { in_sync: true }
        } : {
          ok: true,
          action: "up_to_date",
          auto_update: true,
          current_version: "1.0.80",
          latest_version: "1.0.80",
          skills_status: { in_sync: true }
        }),
        stderr: ""
      };
    });
    const resolveLarkCli = vi.fn(async () => executable);
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment,
      now: () => 1_722_400_000_000,
      resolveLarkCli,
      runProcess,
      pi67Channel: currentPi67Channel()
    });

    const transaction = await management.beginUpdate("lark-cli-global");
    expect(transaction.result.changed).toBe(true);
    expect(transaction.result.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
        installedVersion: "1.0.80",
        latestVersion: "1.0.80",
        updateStatus: "current",
        canUpdate: false
    });
    expect(JSON.stringify(transaction.result)).not.toContain("/mock/lark-cli");
    expect(runProcess).toHaveBeenCalledTimes(3);
    expect(resolveLarkCli).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls.every(([calledExecutable]) => calledExecutable === executable)).toBe(true);
    expect(runProcess.mock.calls.every(([, , options]) => (
      options.environment.PATH?.split(delimiter)[0] === dirname(executable)
      && !options.environment.PATH?.split(delimiter).includes(privateNodeDirectory)
    ))).toBe(true);
  });

  it("fails when an exit-zero update leaves the pinned Lark CLI installation behind", async () => {
    const fixture = await createFixture();
    const runProcess = vi.fn(async (_executable: string, arguments_: string[]) => ({
      stdout: JSON.stringify(arguments_.includes("--check") ? {
        ok: true,
        action: "update_available",
        auto_update: true,
        current_version: "1.0.65",
        latest_version: "1.0.80",
        skills_status: {
          current: "1.0.80",
          in_sync: false,
          official: 27,
          target: "1.0.65",
          updated: 27
        }
      } : { ok: true }),
      stderr: ""
    }));
    const management = createManagement(fixture, { runProcess });

    await expect(management.beginUpdate("lark-cli-global")).rejects.toMatchObject({
      code: "INTERNAL",
      message: expect.stringContaining("same verified installation")
    });
    expect(runProcess).toHaveBeenCalledTimes(3);
  });

  it("ignores a Lark CLI accidentally installed inside the Desktop private toolchain", async () => {
    const fixture = await createFixture();
    const privateToolchainRoot = join(fixture.root, "private-toolchain");
    const privateBin = join(privateToolchainRoot, "node", "bin");
    const userBin = join(fixture.root, "user-node", "bin");
    const executableName = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";
    const privateExecutable = join(privateBin, executableName);
    const userExecutable = join(userBin, executableName);
    await mkdir(privateBin, { recursive: true });
    await mkdir(userBin, { recursive: true });
    await writeFile(privateExecutable, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(userExecutable, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "already_up_to_date",
        current_version: "1.0.80",
        latest_version: "1.0.80",
        skills_status: { current: "1.0.80", in_sync: true }
      }),
      stderr: ""
    }));
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment: {
        PATH: [privateBin, userBin].join(delimiter),
        PI67_TOOLCHAIN_ROOT: privateToolchainRoot,
        PI67_NODE_EXECUTABLE: join(privateBin, process.platform === "win32" ? "node.exe" : "node")
      },
      runProcess,
      pi67Channel: currentPi67Channel()
    });

    await management.checkForUpdates();
    expect(runProcess).toHaveBeenCalledWith(
      resolve(userExecutable),
      ["update", "--check", "--json"],
      expect.any(Object)
    );
    expect(runProcess).not.toHaveBeenCalledWith(
      resolve(privateExecutable),
      expect.any(Array),
      expect.any(Object)
    );
  });

  it("returns an observable unavailable state when the updater cannot be resolved", async () => {
    const fixture = await createFixture();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => undefined
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
        updateStatus: "unavailable",
        canUpdate: false,
        detail: expect.stringContaining("未找到 lark-cli")
    });
  });

  it("activates AI Berkshire as a rollback-safe Overlay and restores the bundled baseline", async () => {
    const fixture = await createFixture();
    const bundled = join(fixture.services.agentDir, "desktop-capabilities", "packages", "pi67-core");
    await mkdir(bundled, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([bundled])
    };
    let stageCount = 0;
    const release = await aiRelease(fixture.root, "1.0.2");
    const channel = {
      check: vi.fn(async () => release),
      stage: vi.fn(async (agentDir: string) => {
        stageCount += 1;
        const stagingSuiteRoot = join(
          managedSkillPackRoot(agentDir, release.id),
          "..",
          `.ai-berkshire.${stageCount}.staging`
        );
        await createAiStaging(stagingSuiteRoot, release);
        return { release, stagingSuiteRoot };
      })
    };
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => "/mock/lark-cli",
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "up_to_date",
          auto_update: true,
          current_version: "1.0.80",
          latest_version: "1.0.80",
          skills_status: { in_sync: true }
        }),
        stderr: ""
      })),
      pi67Channel: channel
    });

    const first = await management.beginUpdate(release.id);
    expect(first.result.items.find((item) => item.id === release.id)).toMatchObject({
      effectiveSource: "managed",
      canRestore: true,
      installedVersion: "1.0.2"
    });
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")[0])
      .toBe(join(managedSkillPackRoot(fixture.services.agentDir, release.id), "package"));
    await first.rollback();
    await expect(management.list()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({
        id: release.id,
        effectiveSource: "bundled",
        canRestore: false,
        installedVersion: "1.0.1"
      })])
    });

    const second = await management.beginUpdate(release.id);
    await second.commit();
    const restore = await management.beginRestore(release.id);
    expect(restore.result.items.find((item) => item.id === release.id)).toMatchObject({
      effectiveSource: "bundled",
      canRestore: false,
      installedVersion: "1.0.1"
    });
    await restore.commit();
  });

  it("rolls back a new Overlay when result projection fails before the transaction is returned", async () => {
    const fixture = await createFixture();
    const bundled = join(fixture.services.agentDir, "desktop-capabilities", "packages", "pi67-core");
    await mkdir(bundled, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([bundled])
    };
    const release = await aiRelease(fixture.root, "1.0.2");
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => "/mock/lark-cli",
      pi67Channel: {
        check: vi.fn(async () => release),
        stage: vi.fn(async (agentDir: string) => {
          const stagingSuiteRoot = join(
            managedSkillPackRoot(agentDir, release.id),
            "..",
            ".ai-berkshire.projection-failure.staging"
          );
          await createAiStaging(stagingSuiteRoot, release);
          await rm(join(fixture.capabilitiesRoot, "catalog.json"));
          return { release, stagingSuiteRoot };
        })
      }
    });

    await expect(management.beginUpdate(release.id)).rejects.toThrow();
    await expect(inspectManagedSkillPack(fixture.services.agentDir, release.id))
      .resolves.toMatchObject({ status: "absent" });
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual([bundled]);
  });

});
