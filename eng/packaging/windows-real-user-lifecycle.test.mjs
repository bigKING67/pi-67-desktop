import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTALLED_RUNTIME_READINESS_TIMEOUT_MS,
  INSTALLED_SHUTDOWN_BUDGET_MS
} from "./windows-installed-application-lifecycle.mjs";
import { assertSessionPathContained } from "./windows-installer-identity.mjs";
import {
  activateCatalogSession,
  assertModelRuntimeInitialization,
  canonicalContainedSessionPath,
  inspectRealUserRuntimeSurface,
  waitForHealthyWorkbenchConvergence,
  waitForRealUserRuntimeReady
} from "./windows-real-user-lifecycle.mjs";
import { resolveRealUserWorkspaceAuthority } from "./windows-real-user-workspace-authority.mjs";
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
    const lifecycleSource = await readFile(
      new URL("./windows-real-user-lifecycle.mjs", import.meta.url),
      "utf8"
    );
    const createFlow = await readFile(
      new URL("./windows-real-user-conversation.mjs", import.meta.url),
      "utf8"
    );
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
    for (const field of [
      "candidateSessionRowCount",
      "newPhysicalSessionFileCount",
      "newPhysicalSessionFileNames",
      "newSessionRowCount",
      "selectedIdentityFingerprint",
      "selectedNewSession",
      "selectedProvisional"
    ]) {
      expect(createFlow).toContain(`${field}: createdSession.diagnostic.${field}`);
    }
    const launchFlow = lifecycleSource.slice(
      lifecycleSource.indexOf("async function runRealUserLaunch"),
      lifecycleSource.indexOf("export async function waitForRealUserRuntimeReady")
    );
    const catalogRequestStart = launchFlow.indexOf("await waitForCatalogRequestStart(");
    const catalogAuthority = launchFlow.indexOf("await waitForCatalogState(");
    expect(catalogRequestStart).toBeGreaterThan(-1);
    expect(catalogAuthority).toBeGreaterThan(catalogRequestStart);
    expect(launchFlow.slice(catalogRequestStart, catalogAuthority))
      .toContain("INSTALLED_RUNTIME_READINESS_TIMEOUT_MS");
    const creationAuthorityReady = launchFlow.indexOf("await waitForRealUserRuntimeReady(");
    const initialProfileVerification = launchFlow.indexOf("await verifyInitialProfileState()");
    const controlledCreate = launchFlow.indexOf("await createControlledConversation(window, agentDir,");
    expect(creationAuthorityReady).toBeGreaterThan(-1);
    expect(initialProfileVerification).toBeGreaterThan(creationAuthorityReady);
    expect(controlledCreate).toBeGreaterThan(creationAuthorityReady);
    expect(controlledCreate).toBeGreaterThan(initialProfileVerification);
    expect(launchFlow.slice(creationAuthorityReady, controlledCreate))
      .toContain("INSTALLED_RUNTIME_READINESS_TIMEOUT_MS");
  });

  it("bootstraps a truly missing clean Profile before the controlled full lifecycle", async () => {
    const lifecycleSource = await readFile(
      new URL("./windows-real-user-lifecycle.mjs", import.meta.url),
      "utf8"
    );
    const bootstrapSource = await readFile(
      new URL("./windows-clean-profile-bootstrap.mjs", import.meta.url),
      "utf8"
    );
    const bootstrap = lifecycleSource.indexOf("await bootstrapFreshProfileLaunch({");
    const normalLaunches = lifecycleSource.indexOf("for (let launchIndex = 0;");
    expect(bootstrap).toBeGreaterThan(-1);
    expect(normalLaunches).toBeGreaterThan(bootstrap);
    expect(bootstrapSource).toContain('profileMode: "fresh"');
    expect(bootstrapSource).toContain("await initializeFirstLaunch({");
    expect(bootstrapSource).toContain(
      "provisioningTimeoutMs: INSTALLED_RUNTIME_READINESS_TIMEOUT_MS"
    );
    expect(bootstrapSource).toContain("Shutdown diagnostics: ${JSON.stringify(shutdownMeasurement)}");
    expect(bootstrapSource).toContain("driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs)");
    expect(bootstrapSource).toContain("shutdownProcesses: shutdownMeasurement.processes");
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

  it("uses the persisted Main Workspace authority for restart Catalog matching", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-workspace-authority-"));
    const canonicalWorkspace = join(root, "canonical-workspace");
    const selectedWorkspace = join(root, "selected-workspace");
    try {
      await mkdir(canonicalWorkspace);
      await symlink(
        canonicalWorkspace,
        selectedWorkspace,
        process.platform === "win32" ? "junction" : "dir"
      );
      const authority = await realpath(canonicalWorkspace);
      const window = {
        evaluate: async () => ({
          availability: "available",
          canonicalPath: authority,
          workspaceCount: 1
        })
      };

      await expect(resolveRealUserWorkspaceAuthority(window, selectedWorkspace, undefined))
        .resolves.toBe(authority);
      await expect(resolveRealUserWorkspaceAuthority(window, selectedWorkspace, `${authority}-drifted`))
        .rejects.toThrow("changed the persisted Main Workspace authority spelling");
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
  it("waits for the Session row view to converge after runtime.ready", async () => {
    const running = workbenchStatusObservation({ runningCount: 1, selectedRunningCount: 1 });
    const idle = workbenchStatusObservation();
    const evaluate = vi.fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce({
        ghostCount: 0,
        rawAcknowledgementTimeout: false,
        rawEnoent: false,
        runningCount: 0
      });

    await expect(waitForHealthyWorkbenchConvergence({ evaluate }, 100)).resolves.toEqual(idle);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("fails closed with bounded diagnostics when a Session status stays running", async () => {
    const observation = workbenchStatusObservation({ runningCount: 1, selectedRunningCount: 1 });

    await expect(waitForHealthyWorkbenchConvergence({
      evaluate: async () => observation
    }, 1)).rejects.toThrow(
      'false running Session after 1ms: {"rowCount":1,"runningCount":1,"selectedRunningCount":1}'
    );
  });

  it("waits for a Catalog Session row that is transiently absent during reconciliation", async () => {
    const clicks = [];
    let observationCount = 0;
    let selectedIdentity;
    const sessionRow = {
      click: async () => {
        selectedIdentity = "session:workspace-1:session.jsonl";
        clicks.push(selectedIdentity);
      },
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
    const selectedRows = {
      evaluateAll: async () => selectedIdentity
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => selectedIdentity !== undefined }),
      locator: (selector) => selector.includes('[aria-current="page"]') ? selectedRows : rows
    };

    await expect(activateCatalogSession(window, undefined, 200))
      .resolves.toBe("session:workspace-1:session.jsonl");
    expect(clicks).toEqual(["session:workspace-1:session.jsonl"]);
  });

  it("activates a materialized Catalog Session when a provisional conversation is already visible", async () => {
    const sessionIdentity = "session:workspace-1:session.jsonl";
    let selectedIdentity = "provisional:workspace-1:draft-1";
    const clicks = [];
    const sessionRow = {
      click: async () => {
        clicks.push(sessionIdentity);
        selectedIdentity = sessionIdentity;
      },
      getAttribute: async () => sessionIdentity
    };
    const rows = {
      count: async () => 1,
      evaluateAll: async () => ({
        provisionalRowCount: 1,
        rowCount: 2,
        sessionRowCount: 1
      }),
      nth: () => sessionRow
    };
    const selectedRows = {
      evaluateAll: async () => selectedIdentity
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => true }),
      locator: (selector) => selector.includes('[aria-current="page"]') ? selectedRows : rows
    };

    await expect(activateCatalogSession(window, undefined, 200)).resolves.toBe(sessionIdentity);
    expect(clicks).toEqual([sessionIdentity]);
  });

  it("reuses an already selected materialized Catalog Session", async () => {
    const sessionIdentity = "session:workspace-1:session.jsonl";
    const selectedRows = {
      evaluateAll: async () => sessionIdentity
    };
    const rows = {
      count: async () => {
        throw new Error("Catalog rows should not be scanned when the selected Session is materialized.");
      }
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => true }),
      locator: (selector) => {
        if (selector.includes('[aria-current="page"]')) return selectedRows;
        return rows;
      }
    };

    await expect(activateCatalogSession(window, undefined, 200)).resolves.toBe(sessionIdentity);
  });

  it("waits for the exact persisted Catalog Session to become selected", async () => {
    const expectedIdentity = "session:workspace-1:expected.jsonl";
    let selectedIdentity = "session:workspace-1:other.jsonl";
    const clicks = [];
    const identities = [selectedIdentity, expectedIdentity];
    const rows = {
      count: async () => identities.length,
      evaluateAll: async () => ({
        provisionalRowCount: 0,
        rowCount: identities.length,
        sessionRowCount: identities.length
      }),
      nth: (index) => ({
        click: async () => {
          selectedIdentity = identities[index];
          clicks.push(selectedIdentity);
        },
        getAttribute: async () => identities[index]
      })
    };
    const selectedRows = {
      evaluateAll: async () => selectedIdentity
    };
    const window = {
      getByLabel: () => ({ isVisible: async () => true }),
      locator: (selector) => selector.includes('[aria-current="page"]') ? selectedRows : rows
    };

    await expect(activateCatalogSession(window, expectedIdentity, 200)).resolves.toBe(expectedIdentity);
    expect(clicks).toEqual([expectedIdentity]);
  });

  it("binds runtime readiness to the activated materialized Session", async () => {
    const sessionIdentity = "session:workspace-1:session.jsonl";
    const runtimeState = [
      { runtimePhase: "ready", selectionMatches: false },
      { runtimePhase: "ready", selectionMatches: true }
    ];
    const waitFor = vi.fn(async () => undefined);
    const readyOrFailed = { waitFor };
    const ready = { or: () => readyOrFailed };
    const failed = { isVisible: async () => false };
    const conversation = { waitFor: async () => undefined };
    const evaluate = vi.fn(async () => runtimeState.shift());
    const window = {
      evaluate,
      getByLabel: () => conversation,
      locator: (selector) => selector.includes('="ready"') ? ready : failed
    };

    await expect(waitForRealUserRuntimeReady(window, sessionIdentity)).resolves.toBeGreaterThanOrEqual(0);
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 15_000 });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("admits initial Session creation only after the Workspace runtime is ready", async () => {
    const runtimeState = [
      { runtimePhase: "starting", selectionMatches: true },
      { runtimePhase: "ready", selectionMatches: true }
    ];
    const waitFor = vi.fn(async () => undefined);
    const readyOrFailed = { waitFor };
    const ready = { or: () => readyOrFailed };
    const failed = { isVisible: async () => false };
    const evaluate = vi.fn(async () => runtimeState.shift());
    const window = {
      evaluate,
      getByLabel: () => ({ waitFor: async () => undefined }),
      locator: (selector) => selector.includes('="ready"') ? ready : failed
    };

    await expect(waitForRealUserRuntimeReady(
      window,
      undefined,
      INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
    )).resolves.toBeGreaterThanOrEqual(0);
    expect(waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("reports bounded and redacted initial runtime failure diagnostics", async () => {
    const observation = {
      acknowledgementTimedOut: false,
      errorNotificationCount: 1,
      errorNotificationMessages: ["无法启动 C:\\private-root\\agent-host"],
      errorNotificationTitles: ["Pi 运行服务启动失败"],
      providerConfigurationFailed: false,
      runtimePhase: "failed",
      runtimeStatus: "当前状态：C:\\private-root\\runtime failed",
      workspaceOpenFailed: false
    };
    const window = { evaluate: vi.fn(async () => observation) };

    await expect(inspectRealUserRuntimeSurface(window, "C:\\private-root")).resolves.toEqual({
      ...observation,
      errorNotificationMessages: ["无法启动 <temporary-root>\\agent-host"],
      runtimeStatus: "当前状态：<temporary-root>\\runtime failed"
    });
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

function workbenchStatusObservation(overrides = {}) {
  return {
    rowCount: 1,
    runningCount: 0,
    selectedRunningCount: 0,
    ...overrides
  };
}
