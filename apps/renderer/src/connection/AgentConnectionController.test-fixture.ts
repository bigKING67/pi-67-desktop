import {
  isRendererHello,
  isRequestCancellationEnvelope,
  isRequestEnvelope,
  welcomeEnvelope,
  type AgentCommandType,
  type RendererHello,
  type RequestCancellationEnvelope,
  type RequestEnvelope
} from "@pi67/protocol";
import {
  AgentConnectionController,
  type AgentPortHandoffTarget
} from "./AgentConnectionController.js";

const controllers: AgentConnectionController[] = [];
const hosts: HostConnection[] = [];

export function disposeAgentConnectionFixtures(): void {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const host of hosts.splice(0)) host.dispose();
}

export class FakeHandoffTarget implements AgentPortHandoffTarget {
  readonly source = {} as MessageEventSource;
  readonly origin = "app://pi67";
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  addMessageListener(listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeMessageListener(listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(
    port: MessagePort,
    overrides: { source?: MessageEventSource; origin?: string; data?: unknown } = {}
  ): void {
    const event = {
      source: overrides.source ?? this.source,
      origin: overrides.origin ?? this.origin,
      data: overrides.data ?? handoff(1),
      ports: [port]
    } as unknown as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

export class HostConnection {
  readonly channel = new MessageChannel();
  readonly requests: RequestEnvelope[] = [];
  readonly cancellations: RequestCancellationEnvelope[] = [];
  hello: RendererHello | undefined;
  private readonly requestWaiters: Array<(request: RequestEnvelope) => void> = [];

  constructor(
    readonly hostEpoch: number,
    private readonly eventSequence = 0,
    private readonly hostInstanceId = `host-${hostEpoch}`
  ) {
    this.channel.port2.addEventListener("message", this.onMessage);
    this.channel.port2.start();
  }

  get controllerPort(): MessagePort {
    return this.channel.port1;
  }

  handoff(
    target: FakeHandoffTarget,
    overrides: { source?: MessageEventSource; origin?: string; data?: unknown } = {}
  ): void {
    target.dispatch(this.channel.port1, {
      ...overrides,
      data: overrides.data ?? handoff(this.hostEpoch)
    });
  }

  send(message: unknown): void {
    this.channel.port2.postMessage(message);
  }

  closeControllerPort(): void {
    this.channel.port1.close();
  }

  async nextRequest<T extends AgentCommandType>(type: T): Promise<RequestEnvelope<T>> {
    const existingIndex = this.requests.findIndex((request) => request.type === type);
    if (existingIndex >= 0) return this.requests.splice(existingIndex, 1)[0] as RequestEnvelope<T>;
    return new Promise((resolve) => {
      this.requestWaiters.push((request) => {
        if (request.type !== type) throw new Error(`Expected ${type}, received ${request.type}.`);
        resolve(request as RequestEnvelope<T>);
      });
    });
  }

  dispose(): void {
    this.channel.port2.removeEventListener("message", this.onMessage);
    this.channel.port1.close();
    this.channel.port2.close();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (isRendererHello(event.data)) {
      this.hello = event.data;
      this.send(welcomeEnvelope({
        appInstanceId: event.data.appInstanceId,
        hostInstanceId: this.hostInstanceId,
        hostEpoch: this.hostEpoch,
        sdkVersion: "0.81.1",
        eventSequence: this.eventSequence,
        capabilities: {
          operations: true,
          eventSequence: true,
          structuredErrors: true,
          transferableImages: true,
          transferableAssets: true,
          idempotentControlMutations: true
        },
        maxEnvelopeBytes: 2 * 1024 * 1024
      }));
      return;
    }
    if (isRequestCancellationEnvelope(event.data)) {
      this.cancellations.push(event.data);
      return;
    }
    if (!isRequestEnvelope(event.data)) return;
    const waiter = this.requestWaiters.shift();
    if (waiter) waiter(event.data);
    else this.requests.push(event.data);
  };
}

export function createController(
  target: FakeHandoffTarget,
  options: ConstructorParameters<typeof AgentConnectionController>[1] = {}
): AgentConnectionController {
  const controller = new AgentConnectionController(target, options);
  controllers.push(controller);
  return controller;
}

export function createHost(hostEpoch: number, eventSequence = 0, hostInstanceId?: string): HostConnection {
  const host = new HostConnection(hostEpoch, eventSequence, hostInstanceId);
  hosts.push(host);
  return host;
}

export function connectionIdentity(hostEpoch: number) {
  return {
    appInstanceId: "app-retry",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

export function readyStatus(detail: string) {
  return { phase: "ready" as const, detail, recoverable: true };
}

export function projectionResyncResult(hostEpoch: number, eventSequence: number) {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    snapshot: emptySnapshot(),
    changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1,
      itemCount: 0,
      source: "sqlite" as const,
      state: "ready" as const,
      rebuilding: false,
      reconciledAt: 1_700_000_000_000,
      incomplete: false,
      skippedCount: 0
    },
    eventSequence,
    hostEpoch,
    sessionGeneration: 1,
    taskToolMode: "auto" as const
  };
}

export async function flushMessagePorts(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function handoff(hostEpoch: number) {
  return {
    source: "pi67-preload" as const,
    type: "agent-port" as const,
    appInstanceId: `app-${hostEpoch}`,
    hostEpoch
  };
}

function emptySnapshot() {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    cwd: "/tmp",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off" as const,
    availableThinkingLevels: ["off" as const],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}
