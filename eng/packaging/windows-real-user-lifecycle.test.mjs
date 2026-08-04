import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTALLED_SHUTDOWN_BUDGET_MS,
  measureInstalledApplicationShutdown
} from "./windows-installed-application-lifecycle.mjs";
import { sessionPathFromIdentity } from "./windows-installer-identity.mjs";
import {
  activateCatalogSession,
  canonicalSessionPathFromIdentity,
  shouldCreateInitialRealUserSession,
  verifyProviderConfiguration,
  waitForCatalogState
} from "./windows-real-user-lifecycle.mjs";
describe("Windows installed real-user lifecycle", () => {
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

  it("waits for a Catalog Session row that is transiently absent during reconciliation", async () => {
    const clicks = [];
    let observationCount = 0;
    const sessionRow = {
      click: async () => clicks.push("session:workspace-1:session.jsonl"),
      getAttribute: async () => "session:workspace-1:session.jsonl"
    };
    const rows = {
      count: async () => observationCount++ === 0 ? 0 : 1,
      evaluateAll: async () => ({
        provisionalRowCount: 0,
        rowCount: 0,
        sessionRowCount: 0
      }),
      nth: () => sessionRow
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => false }),
      locator: () => rows
    };

    await expect(activateCatalogSession(window, undefined, 200)).resolves.toBeUndefined();
    expect(clicks).toEqual(["session:workspace-1:session.jsonl"]);
  });

  it("does not substitute another Catalog Session when the persisted identity is absent", async () => {
    const clicks = [];
    const sessionRow = {
      click: async () => clicks.push("session:workspace-1:other.jsonl"),
      getAttribute: async () => "session:workspace-1:other.jsonl"
    };
    const rows = {
      count: async () => 1,
      evaluateAll: async () => ({
        provisionalRowCount: 0,
        rowCount: 1,
        sessionRowCount: 1
      }),
      nth: () => sessionRow
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => false }),
      locator: () => rows
    };

    await expect(activateCatalogSession(
      window,
      "session:workspace-1:expected.jsonl",
      10
    )).rejects.toThrow('"sessionRowCount":1');
    expect(clicks).toEqual([]);
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
