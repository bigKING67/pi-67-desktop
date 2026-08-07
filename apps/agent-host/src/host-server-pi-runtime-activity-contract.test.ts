import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiSdkRuntime, type AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type AgentCommandType,
  type CommandResults,
  type EventEnvelope,
  type ProtocolPort,
  type RendererHello,
  type ResponseEnvelope
} from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("AgentHostServer Pi runtime activity contract", () => {
  it("projects a real Pi AgentSession event through PiSdkRuntime and Host operation authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-host-pi-activity-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeFile(join(extensionsDirectory, "override-read.ts"), `
      import { Type } from "typebox";
      export default function overrideRead(pi) {
        pi.registerTool({
          name: "read",
          label: "custom read",
          description: "A same-name Extension tool with non-file semantics.",
          parameters: Type.Object({ token: Type.Optional(Type.String()) }),
          async execute() {
            return { content: [{ type: "text", text: "custom" }] };
          }
        });
      }
    `, "utf8");
    const environment = captureEnvironment(["HOME", "USERPROFILE", "PI67_SESSION_CATALOG_DIR", "PI67_STORAGE_ROOT"]);
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.PI67_SESSION_CATALOG_DIR = join(root, "catalog");
    process.env.PI67_STORAGE_ROOT = join(root, "storage");

    const runtime = new PiSdkRuntime();
    let finishPrompt: (() => void) | undefined;
    const promptCompletion = new Promise<void>((resolve) => { finishPrompt = resolve; });
    let server: AgentHostServer | undefined;
    try {
      await runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      const session = runtimeInternals(runtime).sessionBindings.requireSession();
      expect(session.getAllTools().find((tool) => tool.name === "bash")?.sourceInfo).toMatchObject({
        path: "<builtin:bash>",
        source: "builtin",
        scope: "temporary",
        origin: "top-level"
      });
      expect(session.getAllTools().find((tool) => tool.name === "read")?.sourceInfo.source)
        .not.toBe("builtin");

      server = new AgentHostServer(async () => runtimeWithDeferredPrompt(runtime, promptCompletion));
      const port = connect(server, 41);
      const operationId = await submitPrompt(port, 41);

      session.emit({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", delta: "inspect" }
      });
      await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload).toEqual({
        operationId,
        activity: { kind: "thinking" }
      }));

      session.emit({
        type: "tool_execution_start",
        toolCallId: "builtin-bash-call",
        toolName: "bash",
        args: { command: "pwd" }
      });
      await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload).toEqual({
        operationId,
        activity: {
          kind: "tool",
          toolCallId: "builtin-bash-call",
          toolName: "bash",
          toolKind: "shell",
          status: "running"
        }
      }));

      session.emit({
        type: "tool_execution_end",
        toolCallId: "builtin-bash-call",
        toolName: "bash",
        result: { content: [] },
        isError: false
      });
      await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload).toEqual({
        operationId,
        activity: {
          kind: "tool",
          toolCallId: "builtin-bash-call",
          toolName: "bash",
          toolKind: "shell",
          status: "completed"
        }
      }));

      session.emit({
        type: "tool_execution_start",
        toolCallId: "extension-read-call",
        toolName: "read",
        args: { token: "not-a-file" }
      });
      await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload).toEqual({
        operationId,
        activity: {
          kind: "tool",
          toolCallId: "extension-read-call",
          toolName: "read",
          toolKind: "generic",
          status: "running"
        }
      }));

      session.emit({
        type: "tool_execution_end",
        toolCallId: "extension-read-call",
        toolName: "read",
        result: { content: [] },
        isError: false
      });
      await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload).toEqual({
        operationId,
        activity: {
          kind: "tool",
          toolCallId: "extension-read-call",
          toolName: "read",
          toolKind: "generic",
          status: "completed"
        }
      }));

      finishPrompt?.();
      await vi.waitFor(() => expect(operationCompletedEvents(port).some((event) => (
        event.payload.operationId === operationId
      ))).toBe(true));
      await server.shutdown();
      server = undefined;
    } finally {
      finishPrompt?.();
      await server?.shutdown().catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
      restoreEnvironment(environment);
    }
  }, 15_000);
});

interface RuntimeSessionContract {
  readonly getAllTools: () => Array<{
    name: string;
    sourceInfo: { path: string; source: string; scope: string; origin: string };
  }>;
  readonly emit: (event: object) => void;
}

function runtimeInternals(runtime: PiSdkRuntime): {
  sessionBindings: { requireSession: () => RuntimeSessionContract };
} {
  const internals = runtime as unknown as {
    sessionBindings: {
      requireSession: () => RuntimeSessionContract & { _emit: (event: object) => void };
    };
  };
  return {
    sessionBindings: {
      requireSession: () => {
        const session = internals.sessionBindings.requireSession();
        return { getAllTools: () => session.getAllTools(), emit: (event) => session._emit(event) };
      }
    }
  };
}

function runtimeWithDeferredPrompt(runtime: PiSdkRuntime, promptCompletion: Promise<void>): AgentRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "submitPrompt") return () => promptCompletion;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

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

function connect(server: AgentHostServer, hostEpoch: number): FakePort {
  const port = new FakePort();
  server.attachPort(port, {
    appInstanceId: `app-${hostEpoch}`,
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch
  });
  port.emit({
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-${hostEpoch}`,
    appInstanceId: `app-${hostEpoch}`,
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  return port;
}

async function submitPrompt(port: FakePort, hostEpoch: number): Promise<string> {
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  const request = commandEnvelope("prompt.submit", {
    submissionId: `submission-${hostEpoch}`,
    text: "exercise real Pi activity projection",
    delivery: "new-turn"
  }, hostEpoch);
  port.emit(request);
  await vi.waitFor(() => expect(port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === request.requestId
  ))).toMatchObject({ ok: true }));
  const result = responseResult(port, request.requestId, "prompt.submit");
  if (result?.kind !== "accepted") throw new Error("Expected an accepted operation.");
  await vi.waitFor(() => expect(port.sent.some((value) => (
    isEventEnvelope(value) && value.type === "operation.started"
  ))).toBe(true));
  return result.operationId;
}

function responseResult<T extends AgentCommandType>(
  port: FakePort,
  requestId: string,
  type: T
): CommandResults[T] | undefined {
  const response = port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === requestId && value.type === type
  )) as ResponseEnvelope<T> | undefined;
  return response?.ok ? response.result : undefined;
}

function activityEvents(port: FakePort): Array<EventEnvelope<"operation.activityChanged">> {
  return port.sent.filter((value): value is EventEnvelope<"operation.activityChanged"> => (
    isEventEnvelope(value) && value.type === "operation.activityChanged"
  ));
}

function operationCompletedEvents(port: FakePort): Array<EventEnvelope<"operation.completed">> {
  return port.sent.filter((value): value is EventEnvelope<"operation.completed"> => (
    isEventEnvelope(value) && value.type === "operation.completed"
  ));
}

function captureEnvironment(names: readonly string[]): ReadonlyMap<string, string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(environment: ReadonlyMap<string, string | undefined>): void {
  for (const [name, value] of environment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
