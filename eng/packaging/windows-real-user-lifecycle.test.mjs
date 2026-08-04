import { describe, expect, it } from "vitest";
import {
  shouldCreateInitialRealUserSession,
  verifyProviderConfiguration,
  waitForCatalogState
} from "./windows-real-user-lifecycle.mjs";

describe("Windows installed real-user lifecycle", () => {
  it("accepts a Catalog state only after the expected materialized Session is present", async () => {
    const workspaceGroup = {
      evaluate: async (_callback, expectedIdentity) => ({
        hasExpectedSession: expectedIdentity === "session:workspace-1:session.jsonl",
        itemCount: 1,
        text: "Workspace Session"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(
      window,
      "session:workspace-1:session.jsonl",
      100
    )).resolves.toMatchObject({ itemCount: 1, state: "ready" });
  });

  it("fails closed when the installed Catalog reports unavailable", async () => {
    const workspaceGroup = {
      evaluate: async () => ({
        hasExpectedSession: true,
        itemCount: 0,
        text: "Session 目录暂不可用，可稍后刷新重试。"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(window, undefined, 100)).rejects.toThrow(
      "Session Catalog became unavailable"
    );
  });

  it.each([
    ["ready empty", { itemCount: 0, state: "ready-empty" }, true],
    ["rebuilding empty", { itemCount: 0, state: "rebuilding" }, true],
    ["materialized", { itemCount: 1, state: "ready" }, false]
  ])("creates the first real-user Session before activation for %s Catalog state", (
    _label,
    catalog,
    expected
  ) => {
    expect(shouldCreateInitialRealUserSession({
      catalog,
      expectedSessionIdentity: undefined,
      launchIndex: 0
    })).toBe(expected);
  });

  it("requires the exact persisted Session on real-user restarts", () => {
    expect(shouldCreateInitialRealUserSession({
      catalog: { itemCount: 0, state: "ready-empty" },
      expectedSessionIdentity: "session:workspace-1:session.jsonl",
      launchIndex: 1
    })).toBe(false);
  });

  it("requires the Provider configuration panel and returns to the workbench inside the gate", async () => {
    const actions = [];
    const unavailable = { isVisible: async () => false };
    const panel = {
      getByRole: (_role, options) => ({
        waitFor: async ({ state }) => actions.push(`provider:${options.name}:${state}`)
      }),
      or: (other) => {
        expect(other).toBe(unavailable);
        return { waitFor: async ({ state }) => actions.push(`provider-or-error:${state}`) };
      }
    };
    const settings = {
      getByRole: (role, options) => role === "navigation"
        ? asyncButton(actions, `section:${String(options.name)}`)
        : asyncButton(actions, `settings:${String(options.name)}`),
      getByTestId: () => panel,
      getByText: () => unavailable,
      waitFor: async ({ state }) => actions.push(`settings:${state}`)
    };
    const window = {
      getByLabel: () => settings,
      keyboard: { press: async (key) => actions.push(`key:${key}`) }
    };

    await expect(verifyProviderConfiguration(window)).resolves.toMatchObject({ outcome: "ready" });
    expect(actions).toEqual([
      "key:Control+,",
      "settings:visible",
      "click:section:设置分类:/^模型服务/u",
      "provider-or-error:visible",
      "provider:搜索 Pi Provider:visible",
      "click:settings:返回工作台",
      "settings:hidden"
    ]);
  });
});

function asyncButton(actions, prefix) {
  return {
    getByRole: (_role, options) => ({
      click: async () => actions.push(`click:${prefix}:${String(options.name)}`)
    }),
    click: async () => actions.push(`click:${prefix}`)
  };
}
