import { describe, expect, it, vi } from "vitest";
import {
  activateRestoredWorkspace,
  INSTALLED_RUNTIME_READINESS_TIMEOUT_MS,
  launchInstalledApplication,
  resolveInstalledUserInterfaceContract,
  selectLightThemePreference,
  waitForInstalledStartupSurface,
  waitForRuntimeReady,
  WINDOWS_SETTINGS_WORKBENCH_VERSION
} from "./windows-installed-application-lifecycle.mjs";

describe("Windows installed application lifecycle", () => {
  it("fails before launch when a controlled operation has no child PID path", async () => {
    await expect(launchInstalledApplication({ activeControlledOperation: true })).rejects.toThrow(
      "Installed controlled operation requires a child PID path."
    );
  });

  it("selects the installed UI contract by the version being launched", () => {
    expect(WINDOWS_SETTINGS_WORKBENCH_VERSION).toBe("0.1.0-alpha.8");
    expect(resolveInstalledUserInterfaceContract("0.1.0-alpha.7")).toEqual({
      legacyUserInterface: true,
      runtimeReadiness: "legacy-exact-label",
      settingsFlow: "legacy-toolbar-menu"
    });
    expect(resolveInstalledUserInterfaceContract("0.1.0-alpha.8")).toEqual({
      legacyUserInterface: false,
      runtimeReadiness: "runtime-phase-and-conversation",
      settingsFlow: "settings-workbench"
    });
    expect(resolveInstalledUserInterfaceContract("0.1.0-alpha.22"))
      .toMatchObject({ legacyUserInterface: false });
    expect(() => resolveInstalledUserInterfaceContract("not-a-version"))
      .toThrow("Invalid version for installed user interface contract");
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
    const runtimeFailed = {
      getAttribute: async () => null,
      isVisible: async () => false
    };
    const combinedRuntimePhase = {
      waitFor: async (options) => actions.push(`runtime-phase:${options.state}:${options.timeout}`)
    };
    const window = {
      getByLabel: (name) => ({
        waitFor: async (options) => actions.push(`${name}:${options.state}:${options.timeout}`)
      }),
      locator: (selector) => selector === '[data-runtime-phase="failed"]'
        ? runtimeFailed
        : {
            or: (other) => {
              expect(other).toBe(runtimeFailed);
              return combinedRuntimePhase;
            }
          }
    };
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_250);

    await waitForRuntimeReady(window, false);

    expect(actions).toEqual([
      `runtime-phase:visible:${INSTALLED_RUNTIME_READINESS_TIMEOUT_MS}`,
      `Pi conversation:visible:${INSTALLED_RUNTIME_READINESS_TIMEOUT_MS - 250}`
    ]);
  });

  it("fails immediately when the modern runtime enters a failed phase", async () => {
    const actions = [];
    const runtimeFailed = {
      getAttribute: async (name) => {
        actions.push(`attribute:${name}`);
        return "当前状态：Pi SDK 初始化失败";
      },
      isVisible: async () => true
    };
    const combinedRuntimePhase = {
      waitFor: async (options) => actions.push(`runtime-phase:${options.state}:${options.timeout}`)
    };
    const window = {
      getByLabel: () => ({
        waitFor: async () => actions.push("conversation-wait")
      }),
      locator: (selector) => selector === '[data-runtime-phase="failed"]'
        ? runtimeFailed
        : { or: () => combinedRuntimePhase }
    };

    await expect(waitForRuntimeReady(window, false)).rejects.toThrow(
      "Installed runtime entered failed phase before becoming ready: 当前状态：Pi SDK 初始化失败"
    );
    expect(actions).toEqual([
      `runtime-phase:visible:${INSTALLED_RUNTIME_READINESS_TIMEOUT_MS}`,
      "attribute:aria-label"
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
});
