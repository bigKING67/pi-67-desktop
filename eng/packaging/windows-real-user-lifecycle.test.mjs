import { describe, expect, it, vi } from "vitest";
import {
  INSTALLED_SHUTDOWN_BUDGET_MS,
  measureInstalledApplicationShutdown,
  waitForRealUserCreatedSession
} from "./windows-installed-application-lifecycle.mjs";
import {
  shouldCreateInitialRealUserSession,
  verifyProviderConfiguration,
  waitForCatalogState
} from "./windows-real-user-lifecycle.mjs";

describe("Windows installed real-user lifecycle", () => {
  it("polls Session materialization without a blocking active-row locator", async () => {
    vi.useFakeTimers();
    try {
      const provisional = {
        errorNotificationCount: 0,
        newSessionIdentity: null,
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 2,
        runtimePhase: "starting",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionRowCount: 1
      };
      const materialized = {
        ...provisional,
        newSessionIdentity: "session:workspace:new.jsonl",
        newSessionRowCount: 1,
        provisionalRowCount: 0,
        runtimePhase: "ready",
        selectedNewSession: true,
        selectedProvisional: false,
        sessionRowCount: 2
      };
      const window = {
        evaluate: vi.fn()
          .mockResolvedValueOnce(provisional)
          .mockResolvedValueOnce(materialized)
      };

      const pending = waitForRealUserCreatedSession(
        window,
        new Set(["session:workspace:existing.jsonl"]),
        performance.now() + 1_000
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toBe("session:workspace:new.jsonl");
      expect(window.evaluate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports bounded runtime failure diagnostics without exposing the Session identity", async () => {
    vi.useFakeTimers();
    try {
      const window = {
        evaluate: vi.fn().mockResolvedValue({
          errorNotificationCount: 1,
          errorNotificationTitles: ["无法创建 Pi 会话"],
          newSessionIdentity: "session:workspace:sensitive.jsonl",
          newSessionRowCount: 1,
          provisionalRowCount: 0,
          rowCount: 1,
          runtimePhase: "failed",
          runtimeStatus: "当前状态：Pi SDK 初始化失败：configuration reload failed",
          selectedNewSession: false,
          selectedProvisional: false,
          sessionRowCount: 1
        })
      };
      let failure;
      const pending = waitForRealUserCreatedSession(
        window,
        new Set(),
        performance.now() + 100
      ).catch((error) => { failure = error; });

      await vi.advanceTimersByTimeAsync(150);
      await pending;

      expect(String(failure)).toContain("Pi SDK 初始化失败：configuration reload failed");
      expect(String(failure)).toContain("无法创建 Pi 会话");
      expect(String(failure)).not.toContain("sensitive.jsonl");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the installed shutdown budget fixed and records bounded process exit timing", async () => {
    vi.useFakeTimers();
    try {
      const alive = new Set([101, 201, 202, 301]);
      const application = {
        close: () => new Promise((resolve) => {
          setTimeout(() => alive.delete(301), 100);
          setTimeout(() => alive.delete(201), 200);
          setTimeout(() => alive.delete(202), 400);
          setTimeout(() => {
            alive.delete(101);
            resolve();
          }, 600);
        })
      };

      const closing = measureInstalledApplicationShutdown({
        application,
        childPid: 301,
        mainPid: 101,
        pollIntervalMs: 50,
        processAlive: (pid) => alive.has(pid),
        utilityPids: [201, 202]
      });
      await vi.advanceTimersByTimeAsync(600);
      const result = await closing;

      expect(INSTALLED_SHUTDOWN_BUDGET_MS).toBe(5_000);
      expect(result.closeDurationMs).toBe(600);
      expect(result.processes.main).toMatchObject({
        aliveAfterClose: false,
        aliveBeforeClose: true,
        present: true,
        processId: 101
      });
      expect(result.processes.main.exitObservedMs).not.toBeNull();
      expect(result.processes.controlledChild).toMatchObject({
        aliveAfterClose: false,
        aliveBeforeClose: true,
        present: true
      });
      expect(result.processes.controlledChild.exitObservedMs).not.toBeNull();
      expect(result.processes.utilities).toMatchObject({
        aliveAfterCloseCount: 0,
        aliveBeforeCloseCount: 2,
        count: 2,
        observedExitCount: 2
      });
      expect(result.processes.utilities.firstExitObservedMs)
        .toBeLessThan(result.processes.utilities.lastExitObservedMs);
    } finally {
      vi.useRealTimers();
    }
  });

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
