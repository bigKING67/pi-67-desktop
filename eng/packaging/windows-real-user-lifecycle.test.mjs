import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTALLED_SHUTDOWN_BUDGET_MS,
  measureInstalledApplicationShutdown,
  prepareRealUserSessionCreation,
  waitForRealUserCreatedSession
} from "./windows-installed-application-lifecycle.mjs";
import { sessionPathFromIdentity } from "./windows-installer-identity.mjs";
import {
  canonicalSessionPathFromIdentity,
  shouldCreateInitialRealUserSession,
  verifyProviderConfiguration,
  waitForCatalogState
} from "./windows-real-user-lifecycle.mjs";

describe("Windows installed real-user lifecycle", () => {
  it("captures the create baseline only after the action becomes admissible", async () => {
    let actionAdmitted = false;
    const createAction = {
      click: vi.fn(async (options) => {
        expect(options).toEqual({ trial: true, timeout: 15_000 });
        actionAdmitted = true;
      })
    };
    const evaluateAll = vi.fn(async () => {
      expect(actionAdmitted).toBe(true);
      return ["session:workspace:initial.jsonl"];
    });
    const window = {
      getByRole: vi.fn(() => ({ first: () => createAction })),
      locator: vi.fn(() => ({ evaluateAll }))
    };

    const prepared = await prepareRealUserSessionCreation(window, 15_000);

    expect(prepared.createAction).toBe(createAction);
    expect([...prepared.existingIdentities]).toEqual(["session:workspace:initial.jsonl"]);
    expect(createAction.click).toHaveBeenCalledOnce();
    expect(evaluateAll).toHaveBeenCalledOnce();
  });

  it("canonicalizes the Agent root before checking a real Session path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-path-"));
    const canonicalAgentDir = join(root, "canonical-agent");
    const aliasAgentDir = join(root, "alias-agent");
    const sessionPath = join(canonicalAgentDir, "sessions", "session.jsonl");
    try {
      await mkdir(join(canonicalAgentDir, "sessions"), { recursive: true });
      await symlink(canonicalAgentDir, aliasAgentDir, process.platform === "win32" ? "junction" : "dir");
      await writeFile(sessionPath, "{\"type\":\"session\"}\n", "utf8");
      const canonicalSessionPath = await realpath(sessionPath);

      await expect(canonicalSessionPathFromIdentity(
        `session:workspace-12345678:${canonicalSessionPath}`,
        aliasAgentDir
      )).resolves.toBe(canonicalSessionPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["native drive path", "C:\\isolated\\agent", "C:\\isolated\\agent\\sessions\\session.jsonl"],
    ["drive-letter casing", "C:\\isolated\\agent", "c:\\isolated\\agent\\sessions\\session.jsonl"],
    ["forward slashes", "C:/isolated/agent", "C:/isolated/agent/sessions/session.jsonl"],
    ["extended-length Session path", "C:\\isolated\\agent", "\\\\?\\C:\\isolated\\agent\\sessions\\session.jsonl"],
    ["extended-length Agent path", "\\\\?\\C:\\isolated\\agent", "C:\\isolated\\agent\\sessions\\session.jsonl"]
  ])("accepts a contained %s using Windows path semantics", (_label, agentDir, sessionPath) => {
    const identity = `session:workspace-12345678:${sessionPath}`;

    expect(sessionPathFromIdentity(identity, agentDir, win32)).toBe(win32.resolve(sessionPath));
  });

  it.each([
    ["different drive", "C:\\isolated\\agent", "D:\\isolated\\agent\\sessions\\session.jsonl"],
    ["parent traversal", "C:\\isolated\\agent", "C:\\isolated\\agent\\..\\outside\\session.jsonl"],
    ["sibling prefix", "C:\\isolated\\agent", "C:\\isolated\\agent-other\\session.jsonl"]
  ])("rejects a %s outside the isolated Agent directory", (_label, agentDir, sessionPath) => {
    const identity = `session:workspace-12345678:${sessionPath}`;

    expect(() => sessionPathFromIdentity(identity, agentDir, win32)).toThrow(
      "Windows real-user Session JSONL resolved outside the isolated Agent directory."
    );
  });

  it("polls Session materialization without a blocking active-row locator", async () => {
    vi.useFakeTimers();
    try {
      const provisional = {
        errorNotificationCount: 0,
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 2,
        runtimePhase: "starting",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: ["session:workspace:existing.jsonl"],
        sessionRowCount: 1
      };
      const materialized = {
        ...provisional,
        newSessionIdentities: ["session:workspace:new.jsonl"],
        newSessionRowCount: 1,
        provisionalRowCount: 0,
        runtimePhase: "ready",
        selectedIdentity: "session:workspace:new.jsonl",
        selectedNewSession: true,
        selectedProvisional: false,
        sessionIdentities: ["session:workspace:existing.jsonl", "session:workspace:new.jsonl"],
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

  it("reports bounded runtime failure diagnostics without exposing the full Session identity", async () => {
    vi.useFakeTimers();
    try {
      const window = {
        evaluate: vi.fn().mockResolvedValue({
          errorNotificationCount: 1,
          errorNotificationTitles: ["无法创建 Pi 会话"],
          newSessionIdentities: ["session:workspace:sensitive.jsonl"],
          newSessionRowCount: 1,
          provisionalRowCount: 0,
          rowCount: 1,
          runtimePhase: "failed",
          runtimeStatus: "当前状态：Pi SDK 初始化失败：configuration reload failed",
          selectedIdentity: null,
          selectedNewSession: false,
          selectedProvisional: false,
          sessionIdentities: ["session:workspace:sensitive.jsonl"],
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
      expect(String(failure)).toContain("sensitive.jsonl");
      expect(String(failure)).not.toContain("session:workspace:sensitive.jsonl");
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes duplicate path identities for one JSONL without exposing either path", async () => {
    const sessionFileName = "2026-08-04T10-20-30-123Z_11111111-2222-4333-8444-555555555555.jsonl";
    const firstIdentity = `session:workspace:C:\\Users\\person\\.pi\\agent\\sessions\\${sessionFileName}`;
    const secondIdentity = `session:workspace:c:\\users\\person\\.pi\\agent\\sessions\\${sessionFileName}`;
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newSessionIdentities: [firstIdentity, secondIdentity],
        newSessionRowCount: 2,
        provisionalRowCount: 1,
        rowCount: 3,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [firstIdentity, secondIdentity],
        sessionRowCount: 2
      })
    };

    await expect(waitForRealUserCreatedSession(
      window,
      new Set(),
      performance.now() + 1_000
    )).rejects.toThrow(expect.objectContaining({
      message: expect.stringContaining('"distinctNewSessionFileNameCount":1')
    }));

    let failure;
    try {
      await waitForRealUserCreatedSession(window, new Set(), performance.now() + 1_000);
    } catch (error) {
      failure = String(error);
    }
    expect(failure).toContain(`"newSessionFileNames":["${sessionFileName}","${sessionFileName}"]`);
    expect(failure).toMatch(/"newSessionIdentityFingerprints":\["[a-f0-9]{12}","[a-f0-9]{12}"\]/u);
    expect(failure).not.toContain("C:\\Users\\person");
    expect(failure).not.toContain("c:\\users\\person");
    expect(failure).not.toContain(firstIdentity);
    expect(failure).not.toContain(secondIdentity);
  });

  it("reports two distinct JSONL names when duplicate rows represent separate Sessions", async () => {
    const firstFileName = "2026-08-04T10-20-30-123Z_11111111-2222-4333-8444-555555555555.jsonl";
    const secondFileName = "2026-08-04T10-20-31-123Z_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl";
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newSessionIdentities: [
          `session:workspace:C:\\private\\agent\\${firstFileName}`,
          `session:workspace:C:\\private\\agent\\${secondFileName}`
        ],
        newSessionRowCount: 2,
        provisionalRowCount: 1,
        rowCount: 3,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [],
        sessionRowCount: 2
      })
    };

    await expect(waitForRealUserCreatedSession(
      window,
      new Set(),
      performance.now() + 1_000
    )).rejects.toThrow(expect.objectContaining({
      message: expect.stringContaining('"distinctNewSessionFileNameCount":2')
    }));
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
