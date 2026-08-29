import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn(),
  netFetch: vi.fn(),
  showSaveDialog: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  writeFile: mocks.writeFile
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "0.1.0-alpha.10"), isPackaged: false },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showOpenDialog: vi.fn(),
    showSaveDialog: mocks.showSaveDialog
  },
  ipcMain: { handle: mocks.ipcHandle },
  Menu: { buildFromTemplate: vi.fn() },
  net: { fetch: mocks.netFetch },
  Notification: class {},
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
    trashItem: vi.fn()
  }
}));

vi.mock("./browser67-integration.js", () => ({
  openBrowser67ExtensionPage: vi.fn(async () => true)
}));

import { createEmptyWorkbenchState } from "./workbench-state.js";
import { registerSystemBridge } from "./system-bridge.js";

describe("system bridge recovery diagnostics", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
    mocks.showSaveDialog.mockReset();
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/pi67-diagnostics.json" });
    mocks.netFetch.mockReset();
    mocks.writeFile.mockReset();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("projects Desktop recovery state and exports a fixed support schema", async () => {
    registerFixture();

    await expect(invoke("pi67:recovery-snapshot")).resolves.toMatchObject({
      previousRunExitStatus: "unclean",
      pendingSessionCreations: 0,
      attachmentStaging: { draftCount: 2, claimedCount: 1 }
    });
    await expect(invoke("pi67:save-diagnostics", {
      runtimeCollection: { status: "available" },
      runtime: runtimeDiagnostics,
      renderer: rendererDiagnostics
    })).resolves.toBe("/tmp/pi67-diagnostics.json");

    const serialized = mocks.writeFile.mock.calls[0]?.[1];
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized as string)).toEqual(expect.objectContaining({
      schema: "pi67-support-diagnostics.v5",
      application: expect.objectContaining({ version: "0.1.0-alpha.10" }),
      desktop: expect.objectContaining({ previousRunExitStatus: "unclean" }),
      agentHost: expect.objectContaining({
        phase: "running",
        hostEpoch: 4,
        lastStartup: expect.objectContaining({
          profileMode: "existing-shared",
          status: "degraded",
          issues: [{ stage: "browser67-mcp", code: "conflict" }],
          totalDurationMs: 123,
          capabilityProjectionMode: "packaged-direct",
          stageTimings: [
            { stage: "desktop-capabilities", durationMs: 7, outcome: "completed" }
          ]
        })
      }),
      piConfiguration: expect.objectContaining({
        agentDirectory: expect.objectContaining({ state: "missing" }),
        files: [
          { file: "auth.json", state: "directory-unavailable" },
          { file: "settings.json", state: "directory-unavailable" },
          { file: "models.json", state: "directory-unavailable" }
        ]
      }),
      runtimeCollection: { status: "available" },
      runtime: runtimeDiagnostics,
      renderer: rendererDiagnostics
    }));
  });

  it("exports Main-owned diagnostics when the Agent Host does not acknowledge collection", async () => {
    registerFixture();

    await expect(invoke("pi67:save-diagnostics", {
      runtimeCollection: {
        status: "unavailable",
        failure: "acknowledgement-timeout"
      },
      renderer: rendererDiagnostics
    })).resolves.toBe("/tmp/pi67-diagnostics.json");

    const serialized = mocks.writeFile.mock.calls[0]?.[1];
    const document = JSON.parse(String(serialized)) as Record<string, unknown>;
    expect(document).toMatchObject({
      schema: "pi67-support-diagnostics.v5",
      runtimeCollection: {
        status: "unavailable",
        failure: "acknowledgement-timeout"
      },
      renderer: rendererDiagnostics,
      agentHost: { phase: "running", hostEpoch: 4 },
      piConfiguration: expect.any(Object)
    });
    expect(document).not.toHaveProperty("runtime");
  });

  it("uploads the same fixed Main-owned document and returns a verified receipt", async () => {
    registerFixture();
    mocks.netFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected a string request body.");
      const body = init.body;
      const submission = JSON.parse(body) as {
        reportId: string;
        diagnosticsSha256: string;
        diagnostics: unknown;
      };
      const serializedDiagnostics = `${JSON.stringify(submission.diagnostics, null, 2)}\n`;
      expect(submission.diagnosticsSha256).toBe(
        createHash("sha256").update(serializedDiagnostics).digest("hex")
      );
      return new Response(JSON.stringify({
        schema: "pi67-support-receipt.v1",
        reportId: submission.reportId,
        receivedAt: 2,
        sizeBytes: Buffer.byteLength(body, "utf8"),
        sha256: submission.diagnosticsSha256
      }), { status: 201 });
    });

    await expect(invoke("pi67:upload-diagnostics", {
      runtimeCollection: { status: "available" },
      runtime: runtimeDiagnostics,
      renderer: rendererDiagnostics
    })).resolves.toMatchObject({
      schema: "pi67-support-receipt.v1",
      reportId: expect.stringMatching(/^PI67-[A-F0-9]{12}$/u)
    });
    expect(mocks.netFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects Renderer-supplied raw paths before opening the save dialog", async () => {
    registerFixture();

    await expect(invoke("pi67:save-diagnostics", {
      runtimeCollection: { status: "available" },
      runtime: {
        ...runtimeDiagnostics,
        cwd: "/private/workspace"
      },
      renderer: rendererDiagnostics
    })).rejects.toThrow("Invalid diagnostic payload.");

    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await expect(invoke("pi67:upload-diagnostics", {
      runtimeCollection: { status: "available" },
      runtime: {
        ...runtimeDiagnostics,
        cwd: "/private/workspace"
      },
      renderer: rendererDiagnostics
    })).rejects.toThrow("Invalid diagnostic payload.");
    expect(mocks.netFetch).not.toHaveBeenCalled();
  });
});

const runtimeDiagnostics = {
  generatedAt: 3,
  application: "π",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  sessionConfigured: false,
  sessionFileConfigured: false,
  extensionCount: 0,
  extensionErrors: [],
  toolExecutionReceiptFailureCount: 0
};

const rendererDiagnostics = {
  activeRequestCount: 0,
  sampleCount: 2,
  slowAcknowledgementCount: 0,
  slowThresholdMs: 2_000,
  lastAcknowledgementLatencyMs: 12,
  maxAcknowledgementLatencyMs: 18
};

function registerFixture(): void {
  const state = createEmptyWorkbenchState();
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    secureStorage: { ensureAvailable: () => "available" },
    getMainWindow: () => undefined,
    activateMainWindow: async () => undefined,
    desktopToolchain: {},
    desktopCapabilities: {},
    packageNetworkSettings: {},
    promptAttachments: {
      diagnostics: vi.fn(async () => ({
        draftCount: 2,
        claimedCount: 1,
        invalidEntryCount: 0,
        truncated: false
      }))
    },
    promptStashImages: {
      store: vi.fn(),
      restore: vi.fn(),
      delete: vi.fn(),
      removeWorkspace: vi.fn(),
      diagnostics: vi.fn(() => ({ disposed: false })),
      dispose: vi.fn()
    },
    previousRunExit: "unclean",
    agentDirectory: join(tmpdir(), `pi67-missing-agent-${randomUUID()}`),
    agentDirectorySource: "default",
    getAgentHostDiagnostics: vi.fn(() => ({
      phase: "running",
      hostEpoch: 4,
      lastStartup: {
        at: 2,
        hostEpoch: 4,
        profileMode: "existing-shared",
        status: "degraded",
        issues: [{ stage: "browser67-mcp", code: "conflict" }],
        totalDurationMs: 123,
        capabilityProjectionMode: "packaged-direct",
        stageTimings: [
          { stage: "desktop-capabilities", durationMs: 7, outcome: "completed" }
        ]
      },
      restartCount: 0,
      portHandoffCount: 1,
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    })),
    workbenchState: { load: vi.fn(async () => ({ state })) },
    workspaceFileState: {},
    repositoryEnvironmentInspection: { inspect: vi.fn(), removeWorkspace: vi.fn(), dispose: vi.fn() },
    repositoryWorkingTree: {
      inspect: vi.fn(),
      detail: vi.fn(),
      removeWorkspace: vi.fn(),
      diagnostics: vi.fn(() => ({ cachedSnapshotCount: 0, disposed: false })),
      dispose: vi.fn()
    },
    repositoryGitRunner: { diagnostics: vi.fn(() => ({ activeProcessCount: 0, disposed: false })) },
    repositoryMutationScheduler: {
      diagnostics: vi.fn(() => ({
        queuedCount: 0,
        runningCount: 0,
        activeRepositoryCount: 0,
        fencedRepositoryCount: 0,
        disposed: false
      })),
      dispose: vi.fn()
    }
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
