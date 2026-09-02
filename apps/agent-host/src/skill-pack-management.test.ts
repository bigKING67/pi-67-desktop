import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SkillPackManagement
} from "./skill-pack-management.js";
import {
  createFixture,
  createManagement
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
      updateStatus: "application-managed",
      localState: "clean",
      canUpdate: false
    });
    expect(checked.items.find((item) => item.id === "ai-berkshire-investment-suite"))
      .not.toHaveProperty("latestVersion");
    expect(runProcess).toHaveBeenCalledWith(
      "/mock/lark-cli",
      ["update", "--check", "--json"],
      expect.objectContaining({ timeoutMs: 60_000 })
    );
  });

  it("reuses identity-bound update receipts after restart and invalidates them after local Skill drift", async () => {
    const fixture = await createFixture();
    const runProcess = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        action: "up_to_date",
        auto_update: true,
        current_version: "1.0.88",
        latest_version: "1.0.88",
        skills_status: { current: "1.0.88", in_sync: true }
      }),
      stderr: ""
    }));
    await createManagement(fixture, { runProcess }).checkForUpdates();

    const restarted = createManagement(fixture, { runProcess });
    const restored = await restarted.list();
    expect(restored.checkedAt).toBe(1_722_400_000_000);
    expect(restored.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      updateStatus: "current",
      installedVersion: "1.0.88",
      latestVersion: "1.0.88"
    });
    expect(runProcess).toHaveBeenCalledOnce();

    await writeFile(
      join(fixture.homeDirectory, ".agents", "skills", "lark-doc", "SKILL.md"),
      "# locally changed\n",
      "utf8"
    );
    const drifted = await createManagement(fixture, { runProcess }).list();
    const driftedLark = drifted.items.find((item) => item.id === "lark-cli-global");
    expect(driftedLark).toMatchObject({ updateStatus: "not-checked" });
    expect(driftedLark).not.toHaveProperty("installedVersion");
  });

  it("keeps AI Berkshire application-managed without consulting an independent registry", async () => {
    const fixture = await createFixture();
    const management = new SkillPackManagement(fixture.services, {
      capabilitiesRoot: fixture.capabilitiesRoot,
      homeDirectory: fixture.homeDirectory,
      now: () => 1_722_400_000_000,
      resolveLarkCli: async () => undefined
    });

    const checked = await management.checkForUpdates();
    const aiBerkshire = checked.items.find((item) => item.id === "ai-berkshire-investment-suite");
    expect(aiBerkshire).toMatchObject({
      installedVersion: "1.0.1",
      updateStatus: "application-managed",
      canUpdate: false,
      detail: "当前使用随 Desktop 发布的不可变内置基线；不依赖独立更新服务。"
    });
    expect(aiBerkshire).not.toHaveProperty("latestVersion");
    await expect(management.beginUpdate("ai-berkshire-investment-suite"))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
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

  it("offers a Desktop-managed update when the existing Lark CLI cannot update itself", async () => {
    const fixture = await createFixture();
    const management = createManagement(fixture, {
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "update_available",
          auto_update: false,
          current_version: "1.0.57",
          latest_version: "1.0.87",
          skills_status: { current: "1.0.87", in_sync: true }
        }),
        stderr: ""
      }))
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      installedVersion: "1.0.57",
      latestVersion: "1.0.87",
      updateStatus: "update-available",
      localState: "clean",
      canUpdate: true,
      detail: expect.stringContaining("现有 Scoop、npm 或其他外部安装保持不变")
    });
  });

  it("preserves a user-updated Lark CLI when the checked channel is older", async () => {
    const fixture = await createFixture();
    const installLarkCli = vi.fn();
    const management = createManagement(fixture, {
      installLarkCli,
      runProcess: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          action: "up_to_date",
          auto_update: true,
          current_version: "1.0.90",
          latest_version: "1.0.88",
          skills_status: { current: "1.0.90", in_sync: true }
        }),
        stderr: ""
      }))
    });

    const checked = await management.checkForUpdates();
    expect(checked.items.find((item) => item.id === "lark-cli-global")).toMatchObject({
      installedVersion: "1.0.90",
      latestVersion: "1.0.88",
      updateStatus: "current",
      canUpdate: false,
      detail: expect.stringContaining("不会降级")
    });
    const transaction = await management.beginUpdate("lark-cli-global");
    expect(transaction.result.changed).toBe(false);
    expect(installLarkCli).not.toHaveBeenCalled();
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
      runProcess
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

});
