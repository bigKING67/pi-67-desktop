import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";
import type { SessionSnapshot } from "@pi67/domain";
import type { AgentRuntime, PiSdkRuntimeOptions } from "@pi67/pi-runtime";
import {
  isHostWelcome,
  isResponseEnvelope,
  PROTOCOL_REVISION,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolPort,
  type RendererHello,
  type ResponseEnvelope,
  type TaskProtocolContext
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelopeForContext, testTaskContext } from "./protocol-test-fixtures.js";

export class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown): void { this.sent.push(message); }

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

class FakeRuntime {
  private sessionGeneration = 0;
  private sessionPath: string | undefined;
  private cwd = "/tmp";
  private finishPrompt: (() => void) | undefined;
  private nextSessionPath: string | undefined;
  private readonly promptCompletion = new Promise<void>((resolve) => {
    this.finishPrompt = resolve;
  });

  readonly initialize = vi.fn(async (options: Parameters<AgentRuntime["initialize"]>[0]) => {
    this.cwd = options.cwd;
    this.sessionPath = options.sessionPath;
    this.sessionGeneration += 1;
    return this.snapshot();
  });
  readonly getSessionTree = vi.fn(() => ({ nodes: [], truncated: false, total: 0 }));
  readonly createSession = vi.fn(async () => {
    this.sessionPath = this.nextSessionPath;
    this.nextSessionPath = undefined;
    this.sessionGeneration += 1;
    return this.snapshot();
  });
  readonly submitPrompt = vi.fn(() => this.promptCompletion);
  readonly abort = vi.fn(async () => undefined);
  readonly flushStream = vi.fn();
  readonly cancelInteractiveRequests = vi.fn(() => [] as string[]);
  readonly dispose = vi.fn(async () => undefined);

  constructor(readonly id: string) {}

  asRuntime(): AgentRuntime {
    return {
      getSdkVersion: () => "0.81.1",
      getExtensionUiCapabilities: extensionUiCapabilities,
      subscribe: () => () => undefined,
      getIdentity: () => ({
        sessionId: `session-${this.id}`,
        sessionGeneration: this.sessionGeneration,
        ...(this.sessionPath === undefined ? {} : { sessionPath: this.sessionPath })
      }),
      initialize: this.initialize,
      getSnapshot: () => this.snapshot(),
      getSessionTree: this.getSessionTree,
      getWorkspaceChanges: () => ({
        sessionId: `session-${this.id}`,
        items: [],
        truncated: false,
        total: 0
      }),
      createSession: this.createSession,
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
      submitPrompt: this.submitPrompt,
      abort: this.abort,
      flushStream: this.flushStream,
      cancelInteractiveRequests: this.cancelInteractiveRequests,
      dispose: this.dispose
    } as unknown as AgentRuntime;
  }

  completePrompt(): void {
    this.finishPrompt?.();
  }

  useSessionPathForNextCreate(path: string): void {
    this.nextSessionPath = path;
  }

  private snapshot(): SessionSnapshot {
    return {
      sessionId: `session-${this.id}`,
      cwd: this.cwd,
      streaming: false,
      messages: [],
      messagePage: { hasOlder: false, hasNewer: false },
      models: [],
      providers: [],
      thinkingLevel: "off",
      availableThinkingLevels: ["off"],
      steeringQueue: [],
      followUpQueue: [],
      tree: { nodes: [], truncated: false, total: 0 },
      resources: []
    };
  }
}

export async function createServerFixture(runtimeCount: number) {
  const runtimes = Array.from({ length: runtimeCount }, (_, index) => new FakeRuntime(String(index + 1)));
  const options: PiSdkRuntimeOptions[] = [];
  const loader = vi.fn(async (runtimeOptions?: PiSdkRuntimeOptions) => {
    options.push(runtimeOptions ?? {});
    const runtime = runtimes[options.length - 1];
    if (!runtime) throw new Error("Unexpected Runtime load.");
    return runtime.asRuntime();
  });
  const sdkVersionLoader = vi.fn(async () => "0.81.1");
  const server = new AgentHostServer(loader, { sdkVersionLoader });
  const port = new FakePort();
  await attach(server, port);
  return {
    server,
    port,
    loader,
    sdkVersionLoader,
    runtimes,
    options,
    async workspace(name: string) {
      const root = await mkdtemp(join(tmpdir(), `pi67-host-${name}-`));
      const cwd = join(root, "workspace");
      const agentDir = join(root, "agent");
      await Promise.all([mkdir(cwd), mkdir(agentDir)]);
      return { root, cwd, agentDir };
    }
  };
}

export async function attach(server: AgentHostServer, port: FakePort): Promise<void> {
  server.attachPort(port, {
    appInstanceId: "app-multi-task",
    hostInstanceId: "host-multi-task",
    hostEpoch: 7
  });
  port.emit({
    protocolVersion: 3,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: "renderer-multi-task",
    appInstanceId: "app-multi-task",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
}

export function task(workspaceId: string, taskId: string): TaskProtocolContext {
  return testTaskContext(1, { workspaceId, taskId });
}

export function initialize(
  port: FakePort,
  context: TaskProtocolContext,
  workspace: { cwd: string; agentDir: string },
  sessionPath?: string
) {
  return command(port, context, "runtime.initialize", {
    cwd: workspace.cwd,
    agentDir: workspace.agentDir,
    ...(sessionPath === undefined ? {} : { sessionPath }),
    trust: "trusted",
    approvalMode: "guided"
  });
}

export function submit(port: FakePort, context: TaskProtocolContext, submissionId: string) {
  return command(port, context, "prompt.submit", {
    submissionId,
    text: submissionId,
    delivery: "new-turn"
  });
}

export async function command<T extends AgentCommandType>(
  port: FakePort,
  context: TaskProtocolContext,
  type: T,
  payload: CommandPayloads[T],
  idempotencyKey?: string
): Promise<{ response: ResponseEnvelope<T> }> {
  const request = commandEnvelopeForContext(type, payload, context, 7, idempotencyKey);
  port.emit(request);
  let response: ResponseEnvelope<T> | undefined;
  await vi.waitFor(() => {
    const candidate = port.sent.find((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    ));
    expect(candidate).toBeDefined();
    response = candidate as ResponseEnvelope<T>;
  });
  if (!response) throw new Error("Expected a correlated Host response.");
  return { response };
}

function extensionUiCapabilities(): ReturnType<AgentRuntime["getExtensionUiCapabilities"]> {
  return {
    primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
    attribution: "none",
    recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
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
      widgetPlacements: ["aboveEditor", "belowEditor"]
    }
  };
}
