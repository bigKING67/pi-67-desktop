import { describe, expect, it } from "vitest";
import {
  verifyProviderConfiguration,
  REAL_USER_PROVIDER_TIMEOUT_MS
} from "./windows-real-user-provider-configuration.mjs";

describe("Windows installed Provider configuration", () => {
  it("requires the seeded Provider and persisted Pi credential before returning to the workbench", async () => {
    const actions = [];
    const unavailable = { isVisible: async () => false };
    const credentialDialog = dialogLocator(actions, ["false", "true"]);
    const configuredProvider = providerLocator(actions);
    const panel = {
      getByRole: (role, options) => role === "textbox"
        ? waitLocator(actions, `provider:${options.name}`)
        : configuredProvider,
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
    const result = await verifyProviderConfiguration(window);
    expect(result).toMatchObject({
      configuredProvider: "openai",
      credentialProviderSelection: "openai",
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
      "configured-provider:visible",
      "configured-state:visible",
      "click:configured-provider",
      "click:settings:管理凭据",
      "credential-dialog:visible",
      "credential-provider:visible",
      "credential-provider:selected:false",
      "credential-provider:selected:true",
      "credential-persistence:visible",
      "click:credential-close",
      "credential-dialog:hidden",
      "click:settings:返回工作台",
      "settings:hidden"
    ]);
    expect(REAL_USER_PROVIDER_TIMEOUT_MS).toBe(10_000);
  });
});

function navigationLocator(actions) {
  return {
    getByRole: (_role, options) => clickLocator(actions, `section:${String(options.name)}`)
  };
}

function providerLocator(actions) {
  return {
    click: async () => actions.push("click:configured-provider"),
    getByText: () => waitLocator(actions, "configured-state"),
    waitFor: async ({ state }) => actions.push(`configured-provider:${state}`)
  };
}

function dialogLocator(actions, selectedStates) {
  return {
    getByRole: (_role, options) => String(options.name).includes("OpenAI")
      ? {
          getAttribute: async () => {
            const selected = selectedStates.shift() ?? "true";
            actions.push(`credential-provider:selected:${selected}`);
            return selected;
          },
          waitFor: async ({ state }) => actions.push(`credential-provider:${state}`)
        }
      : clickLocator(actions, "credential-close"),
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
