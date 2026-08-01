import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isHostWelcome,
  isResponseEnvelope,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolContext,
  type ProtocolPort,
  type RendererHello,
  type RequestEnvelope,
  type ResponseEnvelope,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

const TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-extensions",
  taskId: "task-extensions",
  taskGeneration: 1
};
const WORKSPACE_CONTEXT: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: TASK_CONTEXT.workspaceId
};

describe("AgentHostServer Extension package commands", () => {
  it("routes Workspace queries and atomically fences the affected Task during mutation reload", async () => {
    const runtime = createRuntime();
    let finishInstall!: () => void;
    const list = vi.fn(() => ({ items: [], total: 0 }));
    const install = vi.fn(() => new Promise<{ items: []; total: 0; changed: true }>((resolve) => {
      finishInstall = () => resolve({ items: [], total: 0, changed: true });
    }));
    const management = {
      list,
      checkForUpdates: vi.fn(async () => ({ items: [], total: 0 })),
      install,
      update: vi.fn(async () => ({ items: [], total: 0, changed: true })),
      setEnabled: vi.fn(async () => ({ items: [], total: 0, changed: true })),
      restoreProjectInheritance: vi.fn(async () => ({ items: [], total: 0, changed: true })),
      uninstall: vi.fn(async () => ({ items: [], total: 0, changed: true }))
    };
    const server = new AgentHostServer(async () => runtime.runtime, {
      sdkVersionLoader: async () => "0.81.1",
      extensionPackageManagementFactory: () => management
    });
    const port = await attach(server);
    const workspace = await createWorkspace();

    await expect(command(port, TASK_CONTEXT, "runtime.initialize", {
      cwd: workspace.cwd,
      agentDir: workspace.agentDir,
      trust: "trusted",
      approvalMode: "guided"
    })).resolves.toMatchObject({ ok: true });

    await expect(command(port, WORKSPACE_CONTEXT, "extension.package.list", {}))
      .resolves.toMatchObject({ ok: true, result: { items: [], total: 0 } });
    expect(list).toHaveBeenCalledOnce();

    const mutation = commandEnvelopeForContext(
      "extension.package.install",
      { source: "npm:example", scope: "project" },
      WORKSPACE_CONTEXT,
      3,
      "install-project"
    );
    port.emit(mutation);

    const blocked = await command(port, TASK_CONTEXT, "resource.list", {});
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "BUSY", details: { retryable: true } }
    });

    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    finishInstall();
    await expect(responseFor(port, mutation)).resolves.toMatchObject({
      ok: true,
      result: { changed: true }
    });
    expect(runtime.reloadResources).toHaveBeenCalledOnce();

    await server.shutdown();
  });

  it("routes Context file commands through Workspace authority and reloads after save", async () => {
    const runtime = createRuntime();
    const id = `ctx_${"c".repeat(64)}`;
    const revision = "d".repeat(64);
    const savedRevision = "e".repeat(64);
    const item = {
      id,
      name: "AGENTS.md",
      path: "/workspace/AGENTS.md",
      category: "rules-context" as const,
      scope: "project" as const,
      origin: "workspace" as const,
      presence: "present" as const,
      access: "editable" as const,
      runtimeState: "active" as const
    };
    const files = { items: [item], workspaceTrusted: true };
    const beginSave = vi.fn(async () => ({
      result: { item, revision: savedRevision, files },
      commit: async () => undefined,
      rollback: async () => undefined
    }));
    const server = new AgentHostServer(async () => runtime.runtime, {
      sdkVersionLoader: async () => "0.81.1",
      contextFileManagementFactory: () => ({
        list: async () => files,
        read: async () => ({ item, content: "# Project\n", revision }),
        mutationScope: async () => "project",
        beginSave
      })
    });
    const port = await attach(server);
    const workspace = await createWorkspace();

    await expect(command(port, TASK_CONTEXT, "runtime.initialize", {
      cwd: workspace.cwd,
      agentDir: workspace.agentDir,
      trust: "trusted",
      approvalMode: "guided"
    })).resolves.toMatchObject({ ok: true });
    await expect(command(port, WORKSPACE_CONTEXT, "context.file.list", {}))
      .resolves.toMatchObject({ ok: true, result: files });
    await expect(command(port, WORKSPACE_CONTEXT, "context.file.read", { id }))
      .resolves.toMatchObject({ ok: true, result: { item, content: "# Project\n", revision } });
    await expect(command(port, WORKSPACE_CONTEXT, "context.file.save", {
      id,
      expectedRevision: revision,
      content: "# Updated\n"
    }, "save-context-file")).resolves.toMatchObject({
      ok: true,
      result: { item, revision: savedRevision, files }
    });
    expect(beginSave).toHaveBeenCalledOnce();
    expect(runtime.reloadResources).toHaveBeenCalledOnce();

    await server.shutdown();
  });

  it("routes Skill Pack queries through the shared global resource fence", async () => {
    const runtime = createRuntime();
    let finishUpdate!: () => void;
    const list = vi.fn(async () => ({ items: [], total: 0 }));
    const update = vi.fn(() => new Promise<{
      result: { items: []; total: 0; changed: true };
      commit(): Promise<void>;
      rollback(): Promise<void>;
    }>((resolve) => {
      finishUpdate = () => resolve({
        result: { items: [], total: 0, changed: true },
        commit: async () => undefined,
        rollback: async () => undefined
      });
    }));
    const server = new AgentHostServer(async () => runtime.runtime, {
      sdkVersionLoader: async () => "0.81.1",
      skillPackManagementFactory: () => ({
        list,
        checkForUpdates: vi.fn(async () => ({ items: [], total: 0 })),
        beginUpdate: update,
        beginRestore: vi.fn(async () => ({
          result: { items: [], total: 0, changed: false },
          commit: async () => undefined,
          rollback: async () => undefined
        }))
      })
    });
    const port = await attach(server);
    const workspace = await createWorkspace();

    await expect(command(port, TASK_CONTEXT, "runtime.initialize", {
      cwd: workspace.cwd,
      agentDir: workspace.agentDir,
      trust: "trusted",
      approvalMode: "guided"
    })).resolves.toMatchObject({ ok: true });
    await expect(command(port, WORKSPACE_CONTEXT, "skill.pack.list", {}))
      .resolves.toMatchObject({ ok: true, result: { items: [], total: 0 } });
    expect(list).toHaveBeenCalledOnce();

    const mutation = commandEnvelopeForContext(
      "skill.pack.update",
      { id: "lark-cli-global" },
      WORKSPACE_CONTEXT,
      3,
      "update-skill-pack"
    );
    port.emit(mutation);
    await expect(command(port, TASK_CONTEXT, "resource.list", {})).resolves.toMatchObject({
      ok: false,
      error: { code: "BUSY" }
    });
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    finishUpdate();
    await expect(responseFor(port, mutation)).resolves.toMatchObject({
      ok: true,
      result: { changed: true }
    });
    expect(runtime.reloadResources).toHaveBeenCalledOnce();

    await server.shutdown();
  });
});

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown): void { this.sent.push(message); }
  close(): void {}
  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

async function attach(server: AgentHostServer): Promise<FakePort> {
  const port = new FakePort();
  server.attachPort(port, { appInstanceId: "app-extensions", hostInstanceId: "host-extensions", hostEpoch: 3 });
  port.emit({
    protocolVersion: 3,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: "renderer-extensions",
    appInstanceId: "app-extensions",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  return port;
}

async function command<T extends AgentCommandType>(
  port: FakePort,
  context: ProtocolContext,
  type: T,
  payload: CommandPayloads[T],
  idempotencyKey?: string
): Promise<ResponseEnvelope<T>> {
  const request = commandEnvelopeForContext(type, payload, context, 3, idempotencyKey);
  port.emit(request);
  return responseFor(port, request);
}

async function responseFor<T extends AgentCommandType>(
  port: FakePort,
  request: RequestEnvelope<T>
): Promise<ResponseEnvelope<T>> {
  let response: ResponseEnvelope<T> | undefined;
  await vi.waitFor(() => {
    response = port.sent.find((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    )) as ResponseEnvelope<T> | undefined;
    expect(response).toBeDefined();
  });
  if (!response) throw new Error("Expected a correlated Host response.");
  return response;
}

async function createWorkspace(): Promise<{ cwd: string; agentDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-extensions-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  return { cwd, agentDir };
}

function createRuntime(): {
  runtime: AgentRuntime;
  reloadResources: ReturnType<typeof vi.fn<AgentRuntime["reloadResources"]>>;
} {
  const snapshot = emptySnapshot();
  const reloadResources = vi.fn<AgentRuntime["reloadResources"]>(async () => ({
    sessionId: snapshot.sessionId,
    controls: { thinkingLevel: "off" },
    modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
    resources: []
  }));
  const runtime = {
    getSdkVersion: () => "0.81.1",
    getExtensionUiCapabilities: () => ({
      primitives: [],
      attribution: "none",
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported",
        editorMutation: "unsupported",
        customComponents: "tui-only",
        autocomplete: "tui-only",
        widgetPlacements: []
      }
    }),
    initialize: async () => snapshot,
    subscribe: () => () => undefined,
    getIdentity: () => ({ sessionId: snapshot.sessionId, sessionGeneration: 1 }),
    getSnapshot: () => snapshot,
    getTaskToolMode: () => "auto" as const,
    getResources: () => [],
    getExtensionCatalog: () => ({ items: [], total: 0, truncated: false }),
    getSessionCatalogStatus: () => ({
      revision: 0,
      itemCount: 0,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    }),
    cancelInteractiveRequests: () => [],
    reloadResources,
    dispose: async () => undefined
  } as unknown as AgentRuntime;
  return { runtime, reloadResources };
}

function emptySnapshot(): SessionSnapshot {
  return {
    sessionId: "session-extensions",
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: [],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}
