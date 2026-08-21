import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LarkCliInstallationError } from "./lark-cli-installation.js";
import { desktopManagedLarkCliExecutable } from "./lark-cli-resolution.js";
import { SkillPackManagement } from "./skill-pack-management.js";
import {
  createFixture,
  currentPi67Channel
} from "./skill-pack-management-test-support.js";

describe("SkillPackManagement Lark CLI installation", () => {
  it("keeps a missing manager visible and installable", async () => {
    const fixture = await createFixture();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => undefined
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      managerStatus: "missing",
      updateStatus: "not-installed",
      canInstall: true,
      canUpdate: false,
      detail: expect.stringContaining("需要先安装官方 Lark CLI")
    });
  });

  it("installs a missing Lark CLI as a replayable rollback-safe Desktop capability", async () => {
    const fixture = await createFixture();
    let executable: string | undefined;
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const installLarkCli = vi.fn(async () => {
      executable = join(fixture.homeDirectory, ".agents", "tools", "lark-cli", "bin", "lark-cli");
      return { executable, version: "1.0.85", commit, rollback };
    });
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "up_to_date",
        auto_update: true,
        current_version: "1.0.85",
        latest_version: "1.0.85",
        skills_status: { current: "1.0.85", in_sync: true }
      }),
      stderr: ""
    }));
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment: { PI67_DESKTOP: "1" },
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => executable,
      installLarkCli,
      runProcess,
      pi67Channel: currentPi67Channel()
    });

    const listed = await management.list();
    expect(listed.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      managerStatus: "missing",
      updateStatus: "not-installed",
      canInstall: true
    });
    const transaction = await management.beginInstall("lark-cli-global");
    expect(transaction.result.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      managerStatus: "ready",
      updateStatus: "current",
      canInstall: false,
      installedVersion: "1.0.85"
    });
    expect(installLarkCli).toHaveBeenCalledOnce();
    expect(installLarkCli).toHaveBeenCalledWith(expect.objectContaining({
      homeDirectory: fixture.homeDirectory,
      skillIds: expect.arrayContaining(["lark-calendar", "lark-doc"])
    }));
    await transaction.rollback();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("offers global installation when an existing CLI only sees private Pi Skills", async () => {
    const fixture = await createFixture();
    await rm(join(fixture.homeDirectory, ".agents", "skills", "lark-calendar"), {
      recursive: true,
      force: true
    });
    await mkdir(join(fixture.services.agentDir, "skills", "lark-calendar"), { recursive: true });
    const existing = join(fixture.root, "user-bin", "lark-cli");
    const installLarkCli = vi.fn(async (_options: unknown) => ({
      executable: existing,
      version: "1.0.85",
      commit: async () => undefined,
      rollback: async () => undefined
    }));
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "up_to_date",
        auto_update: true,
        current_version: "1.0.85",
        latest_version: "1.0.85",
        skills_status: { current: "1.0.85", in_sync: true }
      }),
      stderr: ""
    }));
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      resolveLarkCli: async () => existing,
      installLarkCli,
      synchronizeLarkSkills: async () => {
        await mkdir(join(fixture.homeDirectory, ".agents", "skills", "lark-calendar"), { recursive: true });
        return {
          changed: true,
          installedSkillCount: 2,
          commit: async () => undefined,
          rollback: async () => undefined
        };
      },
      runProcess,
      pi67Channel: currentPi67Channel()
    });

    const listed = await management.list();
    expect(listed.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      managerStatus: "ready",
      installedSkillCount: 2,
      canInstall: true,
      detail: expect.stringContaining("~/.agents/skills")
    });
    const transaction = await management.beginInstall("lark-cli-global");
    expect(installLarkCli).not.toHaveBeenCalled();
    await transaction.rollback();
  });

  it("rejects install requests for arbitrary Skill Pack IDs", async () => {
    const fixture = await createFixture();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      resolveLarkCli: async () => undefined,
      pi67Channel: currentPi67Channel()
    });

    await expect(management.beginInstall("unknown-pack")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
      recoverable: false
    });
  });

  it("rolls back when preserved same-name global Skills remain locally modified", async () => {
    const fixture = await createFixture();
    const rollback = vi.fn(async () => undefined);
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      resolveLarkCli: async () => undefined,
      installLarkCli: async () => ({
        executable: desktopManagedLarkCliExecutable(fixture.homeDirectory),
        version: "1.0.85",
        commit: async () => undefined,
        rollback
      }),
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "up_to_date",
          auto_update: true,
          current_version: "1.0.85",
          latest_version: "1.0.85",
          skills_status: { in_sync: false }
        }),
        stderr: ""
      })),
      pi67Channel: currentPi67Channel()
    });

    await expect(management.beginInstall("lark-cli-global")).rejects.toMatchObject({
      code: "INTERNAL",
      recoverable: true
    });
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("updates a Desktop-managed CLI and global Skills through a rollback-safe reinstall", async () => {
    const fixture = await createFixture();
    const executable = desktopManagedLarkCliExecutable(fixture.homeDirectory);
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const installLarkCli = vi.fn(async () => ({
      executable,
      version: "1.0.85",
      commit,
      rollback
    }));
    let checkCount = 0;
    const runProcess = vi.fn(async () => {
      checkCount += 1;
      return {
        stdout: JSON.stringify(checkCount === 1 ? {
          ok: true,
          action: "update_available",
          auto_update: true,
          current_version: "1.0.80",
          latest_version: "1.0.85",
          skills_status: { in_sync: true }
        } : {
          ok: true,
          action: "up_to_date",
          auto_update: true,
          current_version: "1.0.85",
          latest_version: "1.0.85",
          skills_status: { current: "1.0.85", in_sync: true }
        }),
        stderr: ""
      };
    });
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment: { PI67_DESKTOP: "1" },
      resolveLarkCli: async () => executable,
      installLarkCli,
      runProcess,
      pi67Channel: currentPi67Channel()
    });

    const transaction = await management.beginUpdate("lark-cli-global");
    expect(transaction.result.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      installedVersion: "1.0.85",
      updateStatus: "current",
      localState: "clean"
    });
    expect(installLarkCli).toHaveBeenCalledWith(expect.objectContaining({
      operation: "update",
      skillIds: expect.arrayContaining(["lark-calendar", "lark-doc"])
    }));
    await transaction.rollback();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("poisons the runtime when a failed activation cannot restore the previous Lark CLI", async () => {
    const fixture = await createFixture();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      resolveLarkCli: async () => undefined,
      installLarkCli: async () => {
        throw new LarkCliInstallationError(
          "recovery",
          "Lark CLI 激活失败，且无法恢复之前的 Desktop 管理安装。"
        );
      },
      pi67Channel: currentPi67Channel()
    });

    await expect(management.beginInstall("lark-cli-global")).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      recoverable: false,
      details: { installationStage: "recovery", resourceStateConsistent: false }
    });
  });
});
