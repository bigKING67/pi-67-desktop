import { delimiter, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SkillPackManagement,
  type SkillPackManagementOptions
} from "./skill-pack-management.js";
import { createFixture } from "./skill-pack-management-test-support.js";

describe("SkillPackManagement external Lark CLI update", () => {
  it("adopts an external Lark CLI through a verified Desktop-managed update", async () => {
    const fixture = await createFixture();
    const executable = join(fixture.root, "canonical", "bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
    const managedExecutable = join(
      fixture.homeDirectory,
      ".agents",
      "tools",
      "lark-cli",
      "node_modules",
      "@larksuite",
      "cli",
      "bin",
      process.platform === "win32" ? "lark-cli.exe" : "lark-cli"
    );
    const privateNodeDirectory = join(fixture.root, "private-toolchain", "node", "bin");
    const environment: NodeJS.ProcessEnv = {
      PATH: [privateNodeDirectory, dirname(executable), "/usr/bin"].join(delimiter),
      PI67_NODE_EXECUTABLE: join(privateNodeDirectory, process.platform === "win32" ? "node.exe" : "node")
    };
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const installLarkCli = vi.fn(async () => ({
      executable: managedExecutable,
      version: "1.0.87",
      commit,
      rollback
    }));
    const runProcess = vi.fn(async (
      calledExecutable: string,
      _arguments: string[],
      _options: Parameters<NonNullable<SkillPackManagementOptions["runProcess"]>>[2]
    ) => ({
      stdout: JSON.stringify(calledExecutable === executable ? {
        ok: true,
        action: "update_available",
        auto_update: false,
        current_version: "1.0.57",
        latest_version: "1.0.87",
        skills_status: { in_sync: true }
      } : {
        ok: true,
        action: "up_to_date",
        auto_update: true,
        current_version: "1.0.87",
        latest_version: "1.0.87",
        skills_status: { in_sync: true }
      }),
      stderr: ""
    }));
    const resolveLarkCli = vi.fn(async () => executable);
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      environment,
      now: () => 1_722_400_000_000,
      resolveLarkCli,
      installLarkCli,
      runProcess
    });

    const transaction = await management.beginUpdate("lark-cli-global");
    expect(transaction.result.changed).toBe(true);
    expect(transaction.result.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      installedVersion: "1.0.87",
      latestVersion: "1.0.87",
      updateStatus: "current",
      canUpdate: false
    });
    expect(JSON.stringify(transaction.result)).not.toContain("/mock/lark-cli");
    expect(installLarkCli).toHaveBeenCalledWith(expect.objectContaining({
      operation: "update",
      minimumVersion: "1.0.57",
      targetVersion: "1.0.87",
      skillIds: expect.arrayContaining(["lark-calendar", "lark-doc"])
    }));
    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(resolveLarkCli).toHaveBeenCalledTimes(2);
    expect(runProcess).toHaveBeenCalledWith(executable, ["update", "--check", "--json"], expect.any(Object));
    expect(runProcess).toHaveBeenCalledWith(managedExecutable, ["update", "--check", "--json"], expect.any(Object));
    expect(runProcess).not.toHaveBeenCalledWith(executable, ["update", "--json"], expect.any(Object));
    expect(runProcess.mock.calls.every(([, , options]) => (
      !options.environment.PATH?.split(delimiter).includes(privateNodeDirectory)
    ))).toBe(true);
    await transaction.rollback();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rolls back when the activated Desktop-managed Lark CLI does not converge", async () => {
    const fixture = await createFixture();
    const managedExecutable = join(fixture.homeDirectory, ".agents", "tools", "lark-cli", "bin", "lark-cli");
    const rollback = vi.fn(async () => undefined);
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "update_available",
        auto_update: false,
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
    }));
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      resolveLarkCli: async () => "/mock/lark-cli",
      installLarkCli: async () => ({
        executable: managedExecutable,
        version: "1.0.80",
        commit: async () => undefined,
        rollback
      }),
      runProcess
    });

    await expect(management.beginUpdate("lark-cli-global")).rejects.toMatchObject({
      code: "INTERNAL",
      message: expect.stringContaining("Desktop-managed Lark CLI update did not converge")
    });
    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledOnce();
  });
});
