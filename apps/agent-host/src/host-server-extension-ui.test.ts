import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isEventEnvelope,
  isHostWelcome,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

describe("AgentHostServer extension UI", () => {
  it("advertises strict extension capabilities and enriches UI events with Host context", async () => {
    let emit: ((event: Parameters<Parameters<AgentRuntime["subscribe"]>[0]>[0]) => void) | undefined;
    const runtime = {
      getSdkVersion: () => "0.81.1",
      getExtensionUiCapabilities: extensionUiCapabilities,
      subscribe: (listener: Parameters<AgentRuntime["subscribe"]>[0]) => {
        emit = listener;
        return () => undefined;
      },
      initialize: async () => emptySnapshot(),
      getIdentity: () => ({ sessionId: "session-extension", sessionGeneration: 4 }),
      getSnapshot: () => emptySnapshot(),
      getTaskToolMode: () => "auto" as const,
      submitPrompt: async () => {
        emit?.({
          type: "extension.ui.requested",
          payload: { requestId: "extension-request-1", kind: "input", title: "Name", blocking: true }
        });
        emit?.({
          type: "extension.compatibilityChanged",
          payload: { status: "tui-only", detail: "custom UI requires Pi TUI" }
        });
      },
      flushStream: () => undefined,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-extension", hostInstanceId: "host-extension", hostEpoch: 9 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-extension",
      appInstanceId: "app-extension",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const initialize = commandEnvelope("runtime.initialize", {
      cwd: "/tmp",
      trust: "unknown",
      approvalMode: "guided"
    }, 9);
    port.emit(initialize);
    await vi.waitFor(() => {
      const ready = port.sent.find((value) => isEventEnvelope(value) && value.type === "runtime.ready");
      expect(ready).toMatchObject({
        payload: { capabilities: { extensionUi: { attribution: "none", adapterRegistry: { available: false } } } }
      });
    });

    const prompt = commandEnvelope("prompt.submit", {
      submissionId: "extension-submission",
      text: "ask extension",
      delivery: "new-turn"
    }, 9);
    port.emit(prompt);
    await vi.waitFor(() => {
      const request = port.sent.find((value) => isEventEnvelope(value) && value.type === "extension.ui.requested");
      expect(request).toMatchObject({
        hostEpoch: 9,
        context: {
          scope: "task",
          sessionId: "session-extension",
          sessionGeneration: 4,
          operationId: expect.any(String)
        },
        payload: {
          requestId: "extension-request-1",
          hostEpoch: 9,
          sessionId: "session-extension",
          operationId: expect.any(String)
        }
      });
    });
    const compatibility = port.sent.find((value) => (
      isEventEnvelope(value) && value.type === "extension.compatibilityChanged"
    ));
    expect(compatibility).toMatchObject({
      hostEpoch: 9,
      context: {
        scope: "task",
        sessionId: "session-extension",
        sessionGeneration: 4,
        operationId: expect.any(String)
      },
      payload: {
        hostEpoch: 9,
        sessionId: "session-extension",
        sessionGeneration: 4,
        operationId: expect.any(String),
        status: "tui-only"
      }
    });
    await server.shutdown();
  });
});

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

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

function emptySnapshot() {
  return {
    sessionId: "session-extension",
    cwd: "/tmp",
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
