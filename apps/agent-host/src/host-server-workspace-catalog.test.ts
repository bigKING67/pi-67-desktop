import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isEventEnvelope,
  isResponseEnvelope,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolContext,
  type ResponseEnvelope,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { attach, FakePort } from "./host-server-multi-task-fixture.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

const WORKSPACE: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };
const TASK: TaskProtocolContext = {
  scope: "task",
  workspaceId: WORKSPACE.workspaceId,
  taskId: "task-1",
  taskGeneration: 1
};

const ENVIRONMENT_KEYS = [
  "PI_CODING_AGENT_DIR",
  "PI67_SESSION_CATALOG_DIR",
  "PI67_STORAGE_ROOT"
] as const;

let previousEnvironment: Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;

describe("AgentHostServer Workspace catalog", () => {
  beforeEach(() => {
    previousEnvironment = Object.fromEntries(
      ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    ) as typeof previousEnvironment;
  });

  afterEach(() => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("registers and queries without loading a Task Runtime and survives renderer replacement", async () => {
    const fixture = await workspaceFixture("query");
    const runtimeLoader = vi.fn(async () => { throw new Error("Task Runtime must not load."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const firstPort = new FakePort();
    await attach(server, firstPort);

    expect((await hostCommand(firstPort, WORKSPACE, "workspace.register", {
      cwd: fixture.cwd,
      trust: "trusted",
      approvalMode: "guided"
    }, "register-workspace-1")).response).toMatchObject({
      ok: true,
      result: { registered: true },
      context: WORKSPACE
    });
    expect(runtimeLoader).not.toHaveBeenCalled();

    const providerResponse = (await hostCommand(firstPort, WORKSPACE, "provider.list", {})).response;
    if (!providerResponse.ok) throw new Error(JSON.stringify(providerResponse.error));
    expect(providerResponse).toMatchObject({ ok: true, type: "provider.list", context: WORKSPACE });
    const provider = providerResponse.result.find((candidate) => candidate.modelCount > 0);
    if (!provider) throw new Error("Expected at least one Pi Provider with models.");
    const runtimeKey = "workspace-runtime-secret";
    const configuredResponse = (await hostCommand(firstPort, WORKSPACE, "provider.setRuntimeKey", {
      provider: provider.id,
      apiKey: runtimeKey
    }, "configure-workspace-provider")).response;
    expect(configuredResponse).toMatchObject({
      ok: true,
      type: "provider.setRuntimeKey",
      context: WORKSPACE,
      result: expect.arrayContaining([expect.objectContaining({
        id: provider.id,
        configured: true,
        credentialSource: "runtime"
      })])
    });
    expect(JSON.stringify(configuredResponse)).not.toContain(runtimeKey);
    expect(runtimeLoader).not.toHaveBeenCalled();

    const firstQuery = await hostCommand(firstPort, WORKSPACE, "session.catalog.query", {
      scope: "workspace",
      limit: 50,
      refresh: true
    });
    expect(firstQuery.response).toMatchObject({
      ok: true,
      type: "session.catalog.query",
      context: WORKSPACE,
      result: { items: [], total: 0, hasMore: false }
    });
    expect((await hostCommand(firstPort, WORKSPACE, "session.catalog.query", {
      scope: "all"
    })).response).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED" }
    });
    await vi.waitFor(() => {
      const event = firstPort.sent.find((candidate) => (
        isEventEnvelope(candidate) && candidate.type === "session.catalog.changed"
      ));
      expect(event).toMatchObject({ context: WORKSPACE, payload: { reason: "reconciled" } });
      expect(event).not.toHaveProperty("context.taskId");
      expect(event).not.toHaveProperty("context.sessionId");
    });

    const replacementPort = new FakePort();
    await attach(server, replacementPort);
    expect((await hostCommand(replacementPort, WORKSPACE, "session.catalog.query", {
      scope: "workspace",
      limit: 50
    })).response).toMatchObject({ ok: true, context: WORKSPACE });
    expect(runtimeLoader).not.toHaveBeenCalled();

    expect((await hostCommand(replacementPort, WORKSPACE, "workspace.unregister", {},
      "unregister-workspace-1")).response).toMatchObject({
      ok: true,
      result: { unregistered: true }
    });
    await expect(access(fixture.marker)).resolves.toBeUndefined();
    expect((await hostCommand(replacementPort, WORKSPACE, "session.catalog.query", {
      scope: "workspace"
    })).response).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_NOT_READY" }
    });
    await server.shutdown();
  });

  it("rebuilds Workspace usage without creating or loading a Task Runtime", async () => {
    const fixture = await workspaceFixture("usage");
    const runtimeLoader = vi.fn(async () => { throw new Error("Usage reports must not load a Task Runtime."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const port = new FakePort();

    try {
      await attach(server, port);
      expect((await hostCommand(port, WORKSPACE, "workspace.register", {
        cwd: fixture.cwd,
        trust: "trusted",
        approvalMode: "guided"
      }, "register-usage-workspace")).response).toMatchObject({ ok: true });

      expect((await hostCommand(port, WORKSPACE, "workspace.usage.report", {
        window: "30d"
      })).response).toMatchObject({
        ok: true,
        type: "workspace.usage.report",
        context: WORKSPACE,
        result: {
          workspaceId: WORKSPACE.workspaceId,
          window: "30d",
          buckets: [],
          models: [],
          totals: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0
          },
          coverage: {
            discoveredSessions: 0,
            scannedSessions: 0
          }
        }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
      expect(hostTaskRuntimeCount(server)).toBe(0);

      const missingWorkspace: WorkspaceProtocolContext = {
        scope: "workspace",
        workspaceId: "workspace-missing"
      };
      expect((await hostCommand(port, missingWorkspace, "workspace.usage.report", {
        window: "90d"
      })).response).toMatchObject({
        ok: false,
        error: { code: "RUNTIME_NOT_READY" }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
      expect(hostTaskRuntimeCount(server)).toBe(0);
    } finally {
      await server.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("resolves Session creation from Workspace authority without a Task Runtime", async () => {
    const fixture = await workspaceFixture("creation-resolution");
    const runtimeLoader = vi.fn(async () => {
      throw new Error("Session creation resolution must not load a Task Runtime.");
    });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const port = new FakePort();

    try {
      await attach(server, port);
      expect((await hostCommand(port, WORKSPACE, "workspace.register", {
        cwd: fixture.cwd,
        trust: "trusted",
        approvalMode: "guided"
      }, "register-creation-resolution-workspace")).response).toMatchObject({ ok: true });

      expect((await hostCommand(port, WORKSPACE, "session.creation.resolve", {
        creationId: "creation-authority-regression"
      })).response).toMatchObject({
        ok: true,
        type: "session.creation.resolve",
        context: WORKSPACE,
        result: {
          status: "missing",
          creationId: "creation-authority-regression"
        }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
      expect(hostTaskRuntimeCount(server)).toBe(0);
    } finally {
      await server.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps lifecycle mutations idempotent and blocks unregister while a Task is open", async () => {
    const fixture = await workspaceFixture("lifecycle");
    const runtimeLoader = vi.fn(async () => { throw new Error("Task Runtime must not load."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const port = new FakePort();
    await attach(server, port);
    const registration = {
      cwd: fixture.cwd,
      trust: "trusted" as const,
      approvalMode: "guided" as const
    };

    expect((await hostCommand(port, WORKSPACE, "workspace.register", registration,
      "register-workspace-1")).response).toMatchObject({ ok: true });
    expect((await hostCommand(port, WORKSPACE, "workspace.register", registration,
      "register-workspace-1")).response).toMatchObject({ ok: true, result: { registered: true } });
    expect((await hostCommand(port, WORKSPACE, "workspace.register", {
      ...registration,
      trust: "untrusted"
    }, "register-workspace-1")).response).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_REQUEST" }
    });

    const aliasContext: WorkspaceProtocolContext = {
      scope: "workspace",
      workspaceId: "workspace-alias"
    };
    expect((await hostCommand(port, aliasContext, "workspace.register", {
      ...registration,
      cwd: join(fixture.cwd, "..", "workspace")
    }, "register-workspace-alias")).response).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_REQUEST" }
    });

    expect((await hostCommand(port, TASK, "runtime.getStatus", {})).response)
      .toMatchObject({ ok: true, result: { loaded: false } });
    expect((await hostCommand(port, WORKSPACE, "workspace.unregister", {},
      "unregister-workspace-busy")).response).toMatchObject({
      ok: false,
      error: { code: "BUSY", details: { retryable: true } }
    });
    expect((await hostCommand(port, TASK, "task.close", { mode: "dispose" },
      "close-task-1")).response).toMatchObject({ ok: true, result: { closed: true, stopped: false } });
    expect((await hostCommand(port, WORKSPACE, "workspace.unregister", {},
      "unregister-workspace-final")).response).toMatchObject({
      ok: true,
      result: { unregistered: true }
    });
    expect((await hostCommand(port, WORKSPACE, "workspace.unregister", {},
      "unregister-workspace-final")).response).toMatchObject({
      ok: true,
      result: { unregistered: true }
    });
    expect(runtimeLoader).not.toHaveBeenCalled();
    await server.shutdown();
  });

  it("discovers a configured custom Session directory without loading a Task Runtime", async () => {
    const fixture = await workspaceFixture("custom-session-dir");
    const customSessionDir = join(fixture.root, "custom-sessions");
    const sessionPath = join(customSessionDir, "custom-session.jsonl");
    await mkdir(customSessionDir);
    const canonicalCwd = await realpath(fixture.cwd);
    await Promise.all([
      writeFile(
        join(fixture.agentDir, "settings.json"),
        `${JSON.stringify({ sessionDir: customSessionDir })}\n`,
        "utf8"
      ),
      writeFile(sessionPath, sessionJsonl(canonicalCwd, "custom-session"), "utf8")
    ]);
    const runtimeLoader = vi.fn(async () => { throw new Error("Task Runtime must not load."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const port = new FakePort();

    try {
      await attach(server, port);
      expect((await hostCommand(port, WORKSPACE, "workspace.register", {
        cwd: canonicalCwd,
        trust: "trusted",
        approvalMode: "guided"
      }, "register-custom-session-dir")).response).toMatchObject({ ok: true });
      expect(hostWorkspaceSettings(server, WORKSPACE.workspaceId).getSessionDir())
        .toBe(customSessionDir);

      expect((await hostCommand(port, WORKSPACE, "session.catalog.query", {
        scope: "workspace",
        limit: 50,
        refresh: true
      })).response).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(port.sent.some((value) => (
        isEventEnvelope(value)
        && value.type === "session.catalog.changed"
        && "reason" in value.payload
        && value.payload.reason === "reconciled"
      ))).toBe(true));
      const response = (await hostCommand(port, WORKSPACE, "session.catalog.query", {
        scope: "workspace",
        limit: 50
      })).response;
      const canonicalSessionPath = await realpath(sessionPath);

      expect(response).toMatchObject({
        ok: true,
        result: {
          items: [expect.objectContaining({
            id: "custom-session",
            path: canonicalSessionPath,
            cwd: canonicalCwd
          })],
          total: 1
        }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function workspaceFixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `pi67-workspace-catalog-${name}-`));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const catalogDirectory = join(root, "catalog");
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(catalogDirectory)]);
  const marker = join(cwd, "keep.txt");
  await writeFile(marker, "keep", "utf8");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI67_SESSION_CATALOG_DIR = catalogDirectory;
  process.env.PI67_STORAGE_ROOT = root;
  return { root, cwd, agentDir, catalogDirectory, marker };
}

function sessionJsonl(cwd: string, sessionId: string): string {
  return `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-08-05T00:00:00.000Z",
    cwd
  })}\n`;
}

function hostWorkspaceSettings(server: AgentHostServer, workspaceId: string) {
  return (server as unknown as {
    workspaces: {
      require(id: string): {
        workspaceServices: {
          settingsManager: { getSessionDir(): string | undefined };
        };
      };
    };
  }).workspaces.require(workspaceId).workspaceServices.settingsManager;
}

function hostTaskRuntimeCount(server: AgentHostServer): number {
  return (server as unknown as {
    taskRuntimes: { values(): unknown[] };
  }).taskRuntimes.values().length;
}

async function hostCommand<T extends AgentCommandType>(
  port: FakePort,
  context: ProtocolContext,
  type: T,
  payload: CommandPayloads[T],
  idempotencyKey?: string
): Promise<{ response: ResponseEnvelope<T> }> {
  const request = commandEnvelopeForContext(type, payload, context, 7, idempotencyKey);
  port.emit(request);
  let response: ResponseEnvelope<T> | undefined;
  await vi.waitFor(() => {
    response = port.sent.find((candidate) => (
      isResponseEnvelope(candidate) && candidate.requestId === request.requestId
    )) as ResponseEnvelope<T> | undefined;
    expect(response).toBeDefined();
  });
  if (!response) throw new Error("Expected a correlated Host response.");
  return { response };
}
