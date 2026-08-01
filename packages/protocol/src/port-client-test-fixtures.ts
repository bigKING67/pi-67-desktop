import type { RuntimeCapabilities } from "@pi67/domain";
import { welcomeEnvelope, type ProtocolContext, type RendererHello } from "./envelope.js";
import type { ProtocolPort } from "./port-client.js";

export class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  throwOnPost = false;
  closed = false;

  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error("port failed");
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "message" | "messageerror" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(type === "message" ? { data } : {});
  }
}

export function hostWelcome(hello: RendererHello, hostEpoch: number, eventSequence = 0) {
  return welcomeEnvelope({
    appInstanceId: hello.appInstanceId,
    hostInstanceId: "host-1",
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence,
    capabilities: {
      operations: true,
      eventSequence: true,
      structuredErrors: true,
      transferableImages: true,
      transferableAssets: true,
      idempotentControlMutations: true
    },
    maxEnvelopeBytes: 2 * 1024 * 1024
  });
}

export function taskContext(taskGeneration: number): Extract<ProtocolContext, { scope: "task" }> {
  return {
    scope: "task",
    workspaceId: "workspace-1",
    taskId: "task-1",
    taskGeneration
  };
}

export function emptySnapshot() {
  return {
    sessionId: "session-1",
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

export function projectionResyncResult(hostEpoch: number, eventSequence: number) {
  return {
    snapshot: emptySnapshot(),
    changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: sessionCatalogStatus(),
    eventSequence,
    hostEpoch,
    sessionGeneration: 1,
    taskToolMode: "auto" as const
  };
}

export function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none" as const,
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported" as const,
        editorMutation: "unsupported" as const,
        customComponents: "tui-only" as const,
        autocomplete: "tui-only" as const,
        widgetPlacements: ["aboveEditor" as const, "belowEditor" as const]
      }
    }
  };
}

function sessionCatalogStatus() {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    reconciledAt: 1_700_000_000_000,
    incomplete: false,
    skippedCount: 0
  };
}
