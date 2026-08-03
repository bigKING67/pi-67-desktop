import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateRestoredWorkspace,
  selectLightThemePreference,
  waitForInstalledStartupSurface,
  waitForRuntimeReady
} from "./windows-installed-application-lifecycle.mjs";
import {
  assertPreservedUserData,
  buildNsisInstallArguments,
  resolveExpectedLifecycleSigner,
  resolveUpgradeBaselineInstaller,
  resolveWindowsInstallerPath,
  waitForPathState
} from "./verify-windows-installer-lifecycle.mjs";

const temporaryDirectories = [];
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Windows installer lifecycle contract", () => {
  it("resolves the exact current-version x64 NSIS artifact", () => {
    expect(resolveWindowsInstallerPath("C:\\release", "0.1.0-alpha.3"))
      .toBe(join("C:\\release", "Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe"));
    expect(() => resolveWindowsInstallerPath("C:\\release", "latest"))
      .toThrow("Invalid package version");
  });

  it("keeps the silent NSIS destination argument last and rejects control characters", () => {
    expect(buildNsisInstallArguments("C:\\Pi-67 Desktop 中文"))
      .toEqual(["/S", "/D=C:\\Pi-67 Desktop 中文"]);
    expect(() => buildNsisInstallArguments("C:\\Pi-67\nDesktop"))
      .toThrow("single-line path");
  });

  it("accepts only an older exact Windows x64 installer as the upgrade baseline", () => {
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.2-win-x64.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.2" });
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.1-win-x64-unsigned-preview.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.1" });
    expect(() => resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe",
      "0.1.0-alpha.3"
    )).toThrow("must be an older");
    expect(() => resolveUpgradeBaselineInstaller("C:\\release\\other.exe", "0.1.0-alpha.3"))
      .toThrow("must be an older");
  });

  it("requires a canonical expected Publisher when signed lifecycle verification is enabled", () => {
    expect(resolveExpectedLifecycleSigner(undefined)).toBeUndefined();
    expect(resolveExpectedLifecycleSigner("ab".repeat(20))).toBe("AB".repeat(20));
    expect(() => resolveExpectedLifecycleSigner("not-a-thumbprint"))
      .toThrow("40 hexadecimal");
  });

  it("requires non-empty user data after uninstall", async () => {
    const root = await createTemporaryDirectory();
    const userData = join(root, "user-data");
    await mkdir(userData);
    await expect(assertPreservedUserData(userData)).rejects.toThrow("removed or emptied");
    await writeFile(join(userData, "Local State"), "{}", "utf8");
    await expect(assertPreservedUserData(userData)).resolves.toEqual(["Local State"]);
  });

  it("keeps the installer per-user and preserves application data on uninstall", async () => {
    const builder = await readFile(join(repositoryRoot, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/nsis:[\s\S]*?oneClick:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?perMachine:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?allowToChangeInstallationDirectory:\s*true/u);
    expect(builder).toMatch(/nsis:[\s\S]*?deleteAppDataOnUninstall:\s*false/u);
  });

  it("selects the current light theme through Appearance Settings and returns to the workbench", async () => {
    const actions = [];
    const button = (name) => ({ click: async () => actions.push(`click:${String(name)}`) });
    const navigation = {
      getByRole: (role, options) => {
        actions.push(`role:${role}:${String(options.name)}`);
        return button(options.name);
      }
    };
    const settings = {
      evaluate: async () => ({ columns: "240px 1fr", width: 1_200 }),
      getByRole: (role, options) => {
        actions.push(`role:${role}:${String(options.name)}`);
        return role === "navigation" ? navigation : button(options.name);
      },
      waitFor: async (options) => actions.push(`settings:${options.state}`)
    };
    const window = {
      getByLabel: () => settings,
      getByRole: () => ({ count: async () => 0 }),
      getByTestId: () => ({ count: async () => 0 }),
      keyboard: { press: async (key) => actions.push(`key:${key}`) }
    };

    await selectLightThemePreference(window, false);

    expect(actions).toEqual([
      `key:${process.platform === "darwin" ? "Meta+," : "Control+,"}`,
      "settings:visible",
      "role:navigation:设置分类",
      "role:button:/^外观/u",
      "click:/^外观/u",
      "role:button:/^浅色/u",
      "click:/^浅色/u",
      "role:button:返回工作台",
      "click:返回工作台",
      "settings:hidden"
    ]);
  });

  it.each([
    { pickerVisible: true, runtimeReadyVisible: false, expected: "workspace-picker" },
    { pickerVisible: false, runtimeReadyVisible: true, expected: "runtime-ready" },
    { pickerVisible: false, runtimeReadyVisible: false, expected: "workspace-restored" }
  ])("accepts $expected as an installed startup surface", async ({ pickerVisible, runtimeReadyVisible, expected }) => {
    const actions = [];
    const selectors = [];
    const combined = {
      or: () => combined,
      waitFor: async (options) => actions.push(`combined:${options.state}`)
    };
    const runtimeReady = {
      isVisible: async () => runtimeReadyVisible,
      or: () => combined
    };
    const workspacePicker = {
      isVisible: async () => pickerVisible,
      or: () => combined
    };
    const restoredWorkspace = {
      or: () => restoredWorkspace
    };
    const window = {
      getByLabel: () => restoredWorkspace,
      getByRole: (_role, options) => options.name === "选择工作区" ? workspacePicker : restoredWorkspace,
      locator: (selector) => {
        selectors.push(selector);
        return runtimeReady;
      }
    };

    await expect(waitForInstalledStartupSurface(window, false)).resolves.toBe(expected);
    expect(actions).toEqual(["combined:visible"]);
    expect(selectors).toEqual(['[data-runtime-phase="ready"]']);
  });

  it("accepts any modern ready detail while requiring the conversation surface", async () => {
    const actions = [];
    const window = {
      getByLabel: (name) => ({
        waitFor: async (options) => actions.push(`${name}:${options.state}:${options.timeout}`)
      }),
      locator: (selector) => ({
        waitFor: async (options) => actions.push(`${selector}:${options.state}:${options.timeout}`)
      })
    };

    await waitForRuntimeReady(window, false);

    expect(actions).toEqual([
      '[data-runtime-phase="ready"]:visible:30000',
      "Pi conversation:visible:30000"
    ]);
  });

  it("preserves the legacy exact readiness label", async () => {
    const actions = [];
    const window = {
      getByText: (name, options) => ({
        waitFor: async (waitOptions) => actions.push({ name, options, waitOptions })
      })
    };

    await waitForRuntimeReady(window, true);

    expect(actions).toEqual([{
      name: "Pi SDK 已就绪",
      options: { exact: true },
      waitOptions: { state: "visible", timeout: 30_000 }
    }]);
  });

  it.each([
    { visibleAction: "恢复任务", expected: "task-restored" },
    { visibleAction: "打开会话", expected: "session-opened" },
    { visibleAction: "新建会话", expected: "session-created" }
  ])("activates a restored Workspace through $visibleAction", async ({ visibleAction, expected }) => {
    const actions = [];
    const window = {
      getByLabel: () => ({ isVisible: async () => false }),
      getByRole: (_role, options) => ({
        click: async () => actions.push(`click:${options.name}`),
        isVisible: async () => options.name === visibleAction
      })
    };

    await expect(activateRestoredWorkspace(window)).resolves.toBe(expected);
    expect(actions).toEqual([`click:${visibleAction}`]);
  });

  it("keeps an already active restored conversation without creating another Session", async () => {
    const getByRole = () => {
      throw new Error("No activation action should be queried for an active conversation.");
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => true }),
      getByRole
    };

    await expect(activateRestoredWorkspace(window)).resolves.toBe("conversation");
  });

  it("waits for a path to become present or absent", async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, "artifact.exe");
    setTimeout(() => {
      void writeFile(target, "fixture", "utf8");
    }, 20);
    await expect(waitForPathState(target, true, 1_000)).resolves.toBeUndefined();
    setTimeout(() => {
      void rm(target, { force: true });
    }, 20);
    await expect(waitForPathState(target, false, 1_000)).resolves.toBeUndefined();
  });
});

async function createTemporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-installer-contract-"));
  temporaryDirectories.push(path);
  return path;
}
