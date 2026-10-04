import { describe, expect, it, vi } from "vitest";
import {
  verifyProviderConfiguration,
  REAL_USER_PROVIDER_TIMEOUT_MS
} from "./windows-real-user-provider-configuration.mjs";

describe("Windows installed Provider configuration", () => {
  it("requires the seeded Provider and persisted Pi credential before returning to the workbench", async () => {
    const actions = [];
    const window = providerWindow(actions);
    const result = await verifyProviderConfiguration(window);
    expect(result).toMatchObject({
      configuredProvider: "openai",
      credentialDialogTarget: "openai",
      credentialPersistence: "pi-auth-json",
      outcome: "ready"
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(actions).toEqual([
      "key:Control+,",
      "settings:visible",
      "click:section:模型",
      "provider-or-error:visible",
      "provider:搜索 Pi Provider:visible",
      "click:configured-view",
      "configured-selected:visible",
      "configured-provider:visible",
      "click:configured-provider",
      "click:settings:更新 API Key",
      "credential-dialog:visible",
      "credential-provider-list:count:0",
      "credential-persistence:visible",
      "click:credential-close",
      "credential-dialog:hidden",
      "click:settings:返回工作台",
      "settings:hidden"
    ]);
    expect(REAL_USER_PROVIDER_TIMEOUT_MS).toBe(10_000);
  });

  it("waits for a delayed selected state without clicking again", async () => {
    const actions = [];
    const steps = [];
    let select;
    const selected = new Promise(resolve => { select = resolve; });
    const pending = verifyProviderConfiguration(providerWindow(actions, () => selected), step => steps.push(step));
    await vi.waitFor(() => expect(actions).toContain("configured-selected:visible"));
    expect(actions).not.toContain("click:configured-provider");
    select();
    await expect(pending).resolves.toMatchObject({ outcome: "ready" });
    expect(actions.filter(action => action === "click:configured-view")).toHaveLength(1);
    expect(steps).toContain("configured-view-selected");
    expect(steps.at(-1)).toBe("return-workbench");
  });

  it("fails a stuck selected state within the existing total budget", async () => {
    const actions = [];
    const steps = [];
    const failure = Object.assign(new Error("selection deadline"), { name: "TimeoutError" });
    await expect(verifyProviderConfiguration(providerWindow(actions, async () => { throw failure; }),
      step => steps.push(step))).rejects.toBe(failure);
    expect(steps.at(-1)).toBe("configured-view-selected");
    expect(actions).not.toContain("click:configured-provider");
    expect(actions.filter(action => action === "click:configured-view")).toHaveLength(1);
  });

  it("deducts time spent before selection from the shared deadline", async () => {
    const actions = [];
    let elapsed = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    try {
      await verifyProviderConfiguration(providerWindow(actions, async ({ timeout }) => {
        expect(timeout).toBe(3_000);
      }), step => { if (step === "configured-view-click") elapsed = 7_000; });
      expect(actions.filter(action => action === "click:configured-view")).toHaveLength(1);
    } finally { now.mockRestore(); }
  });
});

function providerWindow(actions, selectionWait = async () => {}) {
  const unavailable = { isVisible: async () => false };
  const credentialDialog = dialogLocator(actions);
  const configuredProvider = providerLocator(actions);
  const panel = {
    getByRole: (role, options) => role === "textbox"
      ? waitLocator(actions, `provider:${options.name}`)
      : catalogTabsLocator(actions, selectionWait),
    getByTestId: (testId) => {
      expect(testId).toBe("provider-configuration-list");
      return { getByRole: () => configuredProvider };
    },
    or: (other) => {
      expect(other).toBe(unavailable);
      return waitLocator(actions, "provider-or-error");
    }
  };
  const settings = {
    getByRole: (role, options) => role === "navigation"
      ? navigationLocator(actions)
      : clickLocator(actions, `settings:${String(options.name)}`),
    getByTestId: () => panel,
    getByText: () => unavailable,
    waitFor: async ({ state }) => actions.push(`settings:${state}`)
  };
  const window = {
    getByLabel: () => settings,
    getByRole: () => credentialDialog,
    keyboard: { press: async (key) => actions.push(`key:${key}`) }
  };
  return window;
}

function navigationLocator(actions) {
  return {
    getByRole: (_role, options) => clickLocator(actions, `section:${String(options.name)}`)
  };
}

function catalogTabsLocator(actions, selectionWait) {
  return {
    getByRole: (role, options) => {
      expect(role).toBe("tab");
      expect("已配置 1").toMatch(options.name);
      if (options.selected) return { waitFor: async ({ state, timeout }) => {
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(REAL_USER_PROVIDER_TIMEOUT_MS);
        actions.push(`configured-selected:${state}`);
        await selectionWait({ timeout });
      } };
      return {
        click: async () => actions.push("click:configured-view"),
        getAttribute: async () => "false" // Old immediate read rejects before the selected state commits.
      };
    }
  };
}

function providerLocator(actions) {
  return {
    click: async () => actions.push("click:configured-provider"),
    waitFor: async ({ state }) => actions.push(`configured-provider:${state}`)
  };
}

function dialogLocator(actions) {
  return {
    getByLabel: () => ({ count: async () => {
      actions.push("credential-provider-list:count:0");
      return 0;
    } }),
    getByRole: () => clickLocator(actions, "credential-close"),
    getByText: () => waitLocator(actions, "credential-persistence"),
    waitFor: async ({ state }) => actions.push(`credential-dialog:${state}`)
  };
}

function clickLocator(actions, name) {
  return { click: async () => actions.push(`click:${name}`) };
}

function waitLocator(actions, name) {
  return { waitFor: async ({ state }) => actions.push(`${name}:${state}`) };
}
