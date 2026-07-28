import {
  AgentPortClient,
  isReplaySafeControlMutation,
  isReplaySafeOperationAck,
  ProtocolRequestError,
  type AgentCommandType,
  type AgentConnectionIdentity,
  type AgentEvent,
  type CommandPayloads,
  type CommandResults,
  type EventEnvelope,
  type ProtocolContext,
  type ProjectionResyncInstaller,
  type SequenceGap
} from "@pi67/protocol";
import { currentWorkbenchProtocolContext } from "../workbench/workbench-protocol-context.js";
import { requestWithBoundedTransportRetry } from "./bounded-transport-retry.js";
import { requestReplaySafeControlMutation } from "./control-mutation-request.js";

interface ConnectionSubscriber {
  onConnected?: (identity: AgentConnectionIdentity) => void;
  onEvent?: (event: AgentEvent, envelope: EventEnvelope) => void;
  onSequenceGap?: (gap: SequenceGap) => void;
  onTeardown?: (error: Error) => void;
}

interface AgentPortHandoff {
  source: "pi67-preload";
  type: "agent-port";
  appInstanceId: string;
  hostEpoch: number;
}

export interface AgentPortHandoffTarget {
  readonly source: MessageEventSource;
  readonly origin: string;
  addMessageListener(listener: (event: MessageEvent) => void): void;
  removeMessageListener(listener: (event: MessageEvent) => void): void;
}

export interface AgentConnectionRequestOptions {
  context?: ProtocolContext;
}

export class AgentConnectionController {
  private readonly subscribers = new Set<ConnectionSubscriber>();
  private client: AgentPortClient | undefined;
  private identityValue: AgentConnectionIdentity | undefined;
  private generation = 0;
  private disposed = false;

  constructor(private readonly handoffTarget = createBrowserHandoffTarget()) {
    this.handoffTarget?.addMessageListener(this.onWindowMessage);
  }

  get identity(): AgentConnectionIdentity | undefined {
    return this.identityValue;
  }

  get hasOpenPort(): boolean {
    return !this.disposed && this.client !== undefined && !this.client.isClosed;
  }

  subscribe(subscriber: ConnectionSubscriber): () => void {
    if (this.disposed) {
      queueMicrotask(() => subscriber.onTeardown?.(disposedError()));
      return () => undefined;
    }
    this.subscribers.add(subscriber);
    const identity = this.identityValue;
    if (identity) queueMicrotask(() => {
      if (this.subscribers.has(subscriber) && this.identityValue === identity) subscriber.onConnected?.(identity);
    });
    return () => this.subscribers.delete(subscriber);
  }

  async waitForConnection(timeoutMs = 15_000): Promise<AgentConnectionIdentity> {
    if (this.disposed) throw disposedError();
    if (this.client && !this.client.isClosed) return this.client.waitUntilReady();
    return new Promise<AgentConnectionIdentity>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        unsubscribe();
        reject(connectionError("Timed out waiting for the Pi runtime service connection."));
      }, timeoutMs);
      const unsubscribe = this.subscribe({
        onConnected: (identity) => {
          globalThis.clearTimeout(timeout);
          unsubscribe();
          resolve(identity);
        },
        onTeardown: (error) => {
          globalThis.clearTimeout(timeout);
          unsubscribe();
          reject(error);
        }
      });
    });
  }

  async request<T extends AgentCommandType>(
    type: T,
    payload: CommandPayloads[T],
    transfer: Transferable[] = [],
    options: AgentConnectionRequestOptions = {}
  ): Promise<CommandResults[T]> {
    if (this.disposed) throw disposedError();
    const expectedHostEpoch = this.identityValue?.hostEpoch;
    const context = options.context ?? requestContext(type, payload);
    if (isReplaySafeControlMutation(type)) {
      return requestReplaySafeControlMutation(
        type,
        (idempotencyKey) => this.requestOnce(type, payload, transfer, context, idempotencyKey),
        () => this.prepareSameHostRetry(expectedHostEpoch)
      ) as Promise<CommandResults[T]>;
    }
    if (isReplaySafeOperationAck(type)) {
      return requestWithBoundedTransportRetry(
        () => this.requestOnce(type, payload, transfer, context),
        () => this.prepareSameHostRetry(expectedHostEpoch)
      ) as Promise<CommandResults[T]>;
    }
    return this.requestOnce(type, payload, transfer, context);
  }

  private async prepareSameHostRetry(expectedHostEpoch: number | undefined): Promise<boolean> {
    return prepareSameHostTransportRetry(
      expectedHostEpoch,
      () => this.waitForConnection(30_000)
    );
  }

  private async requestOnce<T extends AgentCommandType>(
    type: T,
    payload: CommandPayloads[T],
    transfer: Transferable[],
    context: ProtocolContext,
    idempotencyKey?: string
  ): Promise<CommandResults[T]> {
    const client = this.client;
    const generation = this.generation;
    if (!client || client.isClosed) throw connectionError("Pi 运行服务尚未连接。");
    let result: CommandResults[T];
    try {
      result = await client.request(type, payload, transfer, {
        context,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey })
      });
    } catch (error) {
      if (client.isClosed) {
        this.handleTeardown(generation, client, error instanceof Error ? error : connectionError("Agent request failed."));
      }
      throw error;
    }
    if (generation !== this.generation || client !== this.client) {
      throw new ProtocolRequestError({
        code: "STALE_HOST_EPOCH",
        message: "旧 Pi 运行服务的响应已被丢弃。",
        recoverable: true
      });
    }
    return result;
  }

  async resyncProjection(
    install: ProjectionResyncInstaller,
    context: ProtocolContext = currentWorkbenchProtocolContext()
  ): Promise<boolean> {
    if (this.disposed) throw disposedError();
    const client = this.client;
    const generation = this.generation;
    if (!client || client.isClosed) throw connectionError("Pi 运行服务尚未连接。");
    let committed: boolean;
    try {
      committed = await client.resyncProjection((result) => {
        if (generation !== this.generation || client !== this.client) return false;
        return install(result);
      }, context);
    } catch (error) {
      if (client.isClosed) {
        this.handleTeardown(generation, client, error instanceof Error ? error : connectionError("Agent projection resync failed."));
      }
      throw error;
    }
    if (generation !== this.generation || client !== this.client) {
      throw new ProtocolRequestError({
        code: "STALE_HOST_EPOCH",
        message: "旧 Pi 运行服务的重同步结果已被丢弃。",
        recoverable: true
      });
    }
    return committed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handoffTarget?.removeMessageListener(this.onWindowMessage);
    this.generation += 1;
    const client = this.client;
    this.client = undefined;
    this.identityValue = undefined;
    client?.dispose();
    const error = disposedError();
    for (const subscriber of this.subscribers) subscriber.onTeardown?.(error);
    this.subscribers.clear();
  }

  private readonly onWindowMessage = (event: MessageEvent) => {
    if (
      this.disposed
      || !this.handoffTarget
      || event.source !== this.handoffTarget.source
      || event.origin !== this.handoffTarget.origin
      || !isHandoff(event.data)
    ) return;
    const port = event.ports[0];
    if (!port) return;
    this.attachPort(port, event.data);
  };

  private attachPort(port: MessagePort, handoff: AgentPortHandoff): void {
    if (this.disposed) {
      port.close();
      return;
    }
    const generation = ++this.generation;
    this.client?.dispose();
    this.client = undefined;
    this.identityValue = undefined;

    const client = new AgentPortClient(port, {
      appInstanceId: handoff.appInstanceId,
      expectedHostEpoch: handoff.hostEpoch
    });
    this.client = client;
    client.onEvent((event, envelope) => {
      if (generation !== this.generation || client !== this.client) return;
      for (const subscriber of this.subscribers) subscriber.onEvent?.(event, envelope);
    });
    client.onSequenceGap((gap) => {
      if (generation !== this.generation || client !== this.client) return;
      for (const subscriber of this.subscribers) subscriber.onSequenceGap?.(gap);
    });
    const onPortClosed = () => this.handleTeardown(generation, client, connectionError("Agent connection closed."));
    port.addEventListener("close", onPortClosed, { once: true });
    port.addEventListener("messageerror", () => {
      this.handleTeardown(generation, client, connectionError("Agent connection message could not be decoded."));
    }, { once: true });

    void client.waitUntilReady().then((identity) => {
      if (generation !== this.generation || client !== this.client) return;
      this.identityValue = identity;
      for (const subscriber of this.subscribers) subscriber.onConnected?.(identity);
    }).catch((error: unknown) => {
      this.handleTeardown(generation, client, error instanceof Error ? error : connectionError("Pi runtime service handshake failed."));
    });
  }

  private handleTeardown(generation: number, client: AgentPortClient, error: Error): void {
    if (generation !== this.generation || client !== this.client) return;
    this.client = undefined;
    this.identityValue = undefined;
    client.dispose();
    for (const subscriber of this.subscribers) subscriber.onTeardown?.(error);
  }
}

function requestContext<T extends AgentCommandType>(type: T, payload: CommandPayloads[T]): ProtocolContext {
  if (type === "diagnostics.collect" || type === "doctor.run") return { scope: "app" };
  const current = currentWorkbenchProtocolContext();
  if (type === "session.catalog.query") {
    const scope = (payload as CommandPayloads["session.catalog.query"]).scope;
    if (scope === "all") return { scope: "app" };
    return current.scope === "app"
      ? current
      : { scope: "workspace", workspaceId: current.workspaceId };
  }
  return current;
}

export async function prepareSameHostTransportRetry(
  expectedHostEpoch: number | undefined,
  waitForConnection: () => Promise<AgentConnectionIdentity>
): Promise<boolean> {
  if (expectedHostEpoch === undefined) return false;
  const identity = await waitForConnection();
  return identity.hostEpoch === expectedHostEpoch;
}

function isHandoff(value: unknown): value is AgentPortHandoff {
  if (typeof value !== "object" || value === null) return false;
  const handoff = value as Partial<AgentPortHandoff>;
  return handoff.source === "pi67-preload"
    && handoff.type === "agent-port"
    && typeof handoff.appInstanceId === "string"
    && handoff.appInstanceId.length > 0
    && handoff.appInstanceId.length <= 512
    && Number.isSafeInteger(handoff.hostEpoch)
    && Number(handoff.hostEpoch) >= 0;
}

function connectionError(message: string): ProtocolRequestError {
  return new ProtocolRequestError({ code: "CONNECTION_CLOSED", message, recoverable: true });
}

function disposedError(): ProtocolRequestError {
  return connectionError("Agent connection controller has been disposed.");
}

function createBrowserHandoffTarget(): AgentPortHandoffTarget | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    source: window,
    origin: window.location.origin,
    addMessageListener: (listener) => window.addEventListener("message", listener),
    removeMessageListener: (listener) => window.removeEventListener("message", listener)
  };
}

export const agentConnectionController = new AgentConnectionController();
