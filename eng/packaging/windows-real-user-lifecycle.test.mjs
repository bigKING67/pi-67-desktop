import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLED_SHUTDOWN_BUDGET_MS } from "./windows-installed-application-lifecycle.mjs";
import { assertSessionPathContained } from "./windows-installer-identity.mjs";
import {
  activateCatalogSession,
  assertModelRuntimeInitialization,
  canonicalContainedSessionPath,
  shouldCreateInitialRealUserSession,
  waitForCatalogState
} from "./windows-real-user-lifecycle.mjs";
describe("Windows installed real-user lifecycle", () => {
  it("keeps the installed product shutdown budget fixed", () => {
    expect(INSTALLED_SHUTDOWN_BUDGET_MS).toBe(5_000);
  });

  it("requires every observed Pi Provider ModelRuntime startup to complete within budget", () => {
    expect(assertModelRuntimeInitialization([
      { stage: "load-model-runtime", outcome: "started", durationMs: 0 },
      { stage: "load-model-runtime", outcome: "completed", durationMs: 126 }
    ])).toEqual({ attemptCount: 1, maxDurationMs: 126 });

    expect(() => assertModelRuntimeInitialization([])).toThrow(
      "did not observe Pi Provider ModelRuntime startup"
    );
    expect(() => assertModelRuntimeInitialization([
      { stage: "load-model-runtime", outcome: "started", durationMs: 0 },
      { stage: "load-model-runtime", outcome: "failed", durationMs: 4_000 }
    ])).toThrow("did not complete cleanly");
  });

  it("materializes a New Session only after the controlled first Prompt", async () => {
    const source = await readFile(
      new URL("./windows-real-user-lifecycle.mjs", import.meta.url),
      "utf8"
    );
    const createFlow = source.slice(source.indexOf("async function createControlledConversation"));
    const clickIntent = createFlow.indexOf("await createAction.click");
    const provisionalObserved = createFlow.indexOf("await waitForSelectedProvisionalSessionIntent");
    const promptSubmitted = createFlow.indexOf("await submitControlledPromptInput");
    const sessionMaterialized = createFlow.indexOf("await waitForRealUserCreatedSession");
    const controlledModelSelected = createFlow.indexOf("await waitForControlledModel");
    const operationRunning = createFlow.indexOf("await waitForControlledPromptRunning");

    expect(clickIntent).toBeGreaterThan(-1);
    expect(provisionalObserved).toBeGreaterThan(clickIntent);
    expect(promptSubmitted).toBeGreaterThan(provisionalObserved);
    expect(sessionMaterialized).toBeGreaterThan(promptSubmitted);
    expect(controlledModelSelected).toBeGreaterThan(sessionMaterialized);
    expect(operationRunning).toBeGreaterThan(controlledModelSelected);
    expect(createFlow).not.toContain("await startControlledPrompt(window)");
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

      await expect(canonicalContainedSessionPath(
        canonicalSessionPath,
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
    expect(() => assertSessionPathContained(agentDir, sessionPath, win32)).not.toThrow();
  });

  it.each([
    ["different drive", "C:\\isolated\\agent", "D:\\isolated\\agent\\sessions\\session.jsonl"],
    ["parent traversal", "C:\\isolated\\agent", "C:\\isolated\\agent\\..\\outside\\session.jsonl"],
    ["sibling prefix", "C:\\isolated\\agent", "C:\\isolated\\agent-other\\session.jsonl"]
  ])("rejects a %s outside the isolated Agent directory", (_label, agentDir, sessionPath) => {
    expect(() => assertSessionPathContained(agentDir, sessionPath, win32)).toThrow(
      "Windows real-user Session JSONL resolved outside the isolated Agent directory."
    );
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

});
