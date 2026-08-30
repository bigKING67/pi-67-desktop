import {
  AgentPortClient,
  isReplaySafeControlMutation,
  isReplaySafeOperationAck,
  ProtocolRequestError,
  type AgentCommandType,
  type AgentConnectionIdentity,
  type CommandPayloads,
  type CommandResults,
  type ProtocolContext,
  type ProjectionResyncInstaller,
  type RendererAcknowledgementDiagnostics,
  type RendererConnectionTeardownReason,
  type SupportDiagnosticActionName,
  type SupportDiagnosticActionStage
} from "@pi67/protocol";
import { currentWorkbenchProtocolContext } from "../workbench/workbench-protocol-context.js";
import { requestWithBoundedTransportRetry } from "./bounded-transport-retry.js";
import { requestReplaySafeControlMutation } from "./control-mutation-request.js";
import {
  AgentConnectionRecoveryDiagnostics,
  waitForFutureConnection
} from "./agent-connection-recovery-state.js";
import { agentConnectionRequestContext } from "./agent-connection-request-context.js";
import type {
  AgentConnectionControllerOptions,
  AgentConnectionRequestOptions,
  ConnectionSubscriber
} from "./agent-connection-controller-contract.js";
import {
  connectionError,
  disposedError,
  positiveInteger,
  prepareSameHostTransportRetry
} from "./agent-connection-controller-utilities.js";
import {
  createBrowserAgentPortHandoffTarget,
  isAgentPortHandoff,
  type AgentPortHandoff
} from "./agent-port-handoff.js";
import {
  diagnosticActionForCommand,
  RendererDiagnosticEvidence
} from "./renderer-diagnostic-evidence.js";

export type { AgentPortHandoffTarget } from "./agent-port-handoff.js";
export type { AgentConnectionControllerOptions, AgentConnectionRequestOptions } from "./agent-connection-controller-contract.js";

const DEFAULT_SLOW_ACKNOWLEDGEMENT_THRESHOLD_MS = 2_000;

export class AgentConnectionController {
  private readonly subscribers = new Set<ConnectionSubscriber>();
  private client: AgentPortClient | undefined;
  private identityValue: AgentConnectionIdentity | undefined;
  private portAttachedAt: number | undefined;
  private generation = 0;
  private receivedPort = false;
  private disposed = false;
  private readonly now: () => number;
  private readonly recoveryDiagnostics: AgentConnectionRecoveryDiagnostics;
  private readonly diagnosticEvidence: RendererDiagnosticEvidence;
  private readonly slowAcknowledgementThresholdMs: number;
  private activeRequestCount = 0;
  private sampleCount = 0;
  private slowAcknowledgementCount = 0;
  private lastAcknowledgementLatencyMs: number | undefined;
  private maxAcknowledgementLatencyMs: number | undefined;

  constructor(
    private readonly handoffTarget = createBrowserAgentPortHandoffTarget(),
    options: AgentConnectionControllerOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.recoveryDiagnostics = new AgentConnectionRecoveryDiagnostics(this.now);
    this.diagnosticEvidence = new RendererDiagnosticEvidence(this.now);
    this.slowAcknowledgementThresholdMs = positiveInteger(
      options.slowAcknowledgementThresholdMs,
      DEFAULT_SLOW_ACKNOWLEDGEMENT_THRESHOLD_MS,
      "slowAcknowledgementThresholdMs"
    );
    this.handoffTarget?.addMessageListener(this.onWindowMessage);
  }

  get identity(): AgentConnectionIdentity | undefined {
    return this.identityValue;
  }

  get hasOpenPort(): boolean {
    return !this.disposed && this.client !== undefined && !this.client.isClosed;
  }

  get hasReceivedPort(): boolean {
    return this.receivedPort;
  }

  get connectionGeneration(): number {
    return this.generation;
  }

  assertAutomaticReplacementAllowed(): void {
    try {
      this.recoveryDiagnostics.assertAutomaticReplacementAllowed();
    } catch (error) {
      this.diagnosticEvidence.recordAutomaticReplacementSuppressed(error, this.generation);
      throw error;
    }
  }

  diagnostics(): RendererAcknowledgementDiagnostics {
    return {
      activeRequestCount: this.activeRequestCount,
      sampleCount: this.sampleCount,
      slowAcknowledgementCount: this.slowAcknowledgementCount,
      slowThresholdMs: this.slowAcknowledgementThresholdMs,
      ...this.recoveryDiagnostics.snapshot(this.generation),
      causality: this.diagnosticEvidence.snapshot(),
      ...(this.lastAcknowledgementLatencyMs === undefined
        ? {}
        : { lastAcknowledgementLatencyMs: this.lastAcknowledgementLatencyMs }),
      ...(this.maxAcknowledgementLatencyMs === undefined
        ? {}
        : { maxAcknowledgementLatencyMs: this.maxAcknowledgementLatencyMs })
    };
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

  recordDiagnosticAction(action: SupportDiagnosticActionName, stage: SupportDiagnosticActionStage): void {
    this.diagnosticEvidence.recordAction(action, stage);
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

  async waitForConnectionAfter(
    generation: number,
    timeoutMs = 15_000
  ): Promise<AgentConnectionIdentity> {
    return waitForFutureConnection({
      afterGeneration: generation,
      timeoutMs,
      current: () => ({
        disposed: this.disposed,
        generation: this.generation,
        identity: this.identityValue
      }),
      subscribe: (subscriber) => this.subscribe(subscriber)
    }, this.recoveryDiagnostics);
  }

  async request<T extends AgentCommandType>(
    type: T,
    payload: CommandPayloads[T],
    transfer: Transferable[] = [],
    options: AgentConnectionRequestOptions = {}
  ): Promise<CommandResults[T]> {
    if (this.disposed) throw disposedError();
    const action = diagnosticActionForCommand(type);
    if (action) this.diagnosticEvidence.recordAction(action, "started");
    const expectedHostEpoch = this.identityValue?.hostEpoch;
    const context = options.context ?? agentConnectionRequestContext(type, payload);
    try {
      let result: CommandResults[T];
      if (isReplaySafeControlMutation(type)) {
        result = await requestReplaySafeControlMutation(
          type,
          (idempotencyKey, attempt) => this.requestOnce(
            type,
            payload,
            transfer,
            context,
            idempotencyKey,
            type === "session.create" ? (attempt === 0 ? 5_000 : 10_000) : undefined,
            options.signal
          ),
          () => this.prepareSameHostRetry(expectedHostEpoch),
          options.onAcknowledgementDelayed
        ) as CommandResults[T];
      } else if (isReplaySafeOperationAck(type)) {
        result = await requestWithBoundedTransportRetry(
          () => this.requestOnce(type, payload, transfer, context, undefined, undefined, options.signal),
          () => this.prepareSameHostRetry(expectedHostEpoch)
        ) as CommandResults[T];
      } else {
        result = await this.requestOnce(
          type,
          payload,
          transfer,
          context,
          undefined,
          options.ackTimeoutMs,
          options.signal
        );
      }
      if (action) this.diagnosticEvidence.recordAction(action, "completed");
      return result;
    } catch (error) {
      if (action) this.diagnosticEvidence.recordAction(action, "failed");
      throw error;
    }
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
    idempotencyKey?: string,
    ackTimeoutMs?: number,
    signal?: AbortSignal
  ): Promise<CommandResults[T]> {
    const client = this.client;
    const generation = this.generation;
    if (!client || client.isClosed) throw connectionError("Pi 运行服务尚未连接。");
    const startedAt = this.now();
    const hostEpoch = this.identityValue?.hostEpoch;
    this.diagnosticEvidence.recordRequestStarted(type, generation, hostEpoch);
    this.activeRequestCount += 1;
    try {
      let result: CommandResults[T];
      try {
        result = await client.request(type, payload, transfer, {
          context,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }),
          ...(signal === undefined ? {} : { signal })
        });
      } catch (error) {
        if (client.isClosed) {
          this.handleTeardown(
            generation,
            client,
            error instanceof Error ? error : connectionError("Agent request failed."),
            "protocol-violation"
          );
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
      this.recordAcknowledgement(this.now() - startedAt);
      this.diagnosticEvidence.recordRequestSettled({
        command: type,
        connectionGeneration: generation,
        ...(hostEpoch === undefined ? {} : { hostEpoch }),
        startedAt
      });
      return result;
    } catch (error) {
      this.diagnosticEvidence.recordRequestSettled({
        command: type,
        connectionGeneration: generation,
        ...(hostEpoch === undefined ? {} : { hostEpoch }),
        startedAt,
        error
      });
      throw error;
    } finally {
      this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
    }
  }

  private recordAcknowledgement(durationMs: number): void {
    const latency = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(durationMs)));
    this.sampleCount = Math.min(Number.MAX_SAFE_INTEGER, this.sampleCount + 1);
    this.lastAcknowledgementLatencyMs = latency;
    this.maxAcknowledgementLatencyMs = Math.max(this.maxAcknowledgementLatencyMs ?? 0, latency);
    if (latency >= this.slowAcknowledgementThresholdMs) {
      this.slowAcknowledgementCount = Math.min(Number.MAX_SAFE_INTEGER, this.slowAcknowledgementCount + 1);
    }
  }

  async resyncProjection(
    install: ProjectionResyncInstaller,
    context: ProtocolContext = currentWorkbenchProtocolContext()
  ): Promise<boolean> {
    if (this.disposed) throw disposedError();
    const client = this.client;
    const generation = this.generation;
    if (!client || client.isClosed) throw connectionError("Pi 运行服务尚未连接。");
    const startedAt = this.now();
    const hostEpoch = this.identityValue?.hostEpoch;
    this.diagnosticEvidence.recordProjectionStarted(generation, hostEpoch);
    let committed: boolean;
    try {
      committed = await client.resyncProjection((result) => {
        if (generation !== this.generation || client !== this.client) return false;
        return install(result);
      }, context);
    } catch (error) {
      this.diagnosticEvidence.recordProjectionSettled({
        connectionGeneration: generation,
        ...(hostEpoch === undefined ? {} : { hostEpoch }),
        startedAt,
        error
      });
      if (client.isClosed) {
        this.handleTeardown(
          generation,
          client,
          error instanceof Error ? error : connectionError("Agent projection resync failed."),
          "protocol-violation"
        );
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
    this.diagnosticEvidence.recordProjectionSettled({
      connectionGeneration: generation,
      ...(hostEpoch === undefined ? {} : { hostEpoch }),
      startedAt,
      committed
    });
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
    this.portAttachedAt = undefined;
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
      || !isAgentPortHandoff(event.data)
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
    this.receivedPort = true;
    const generation = ++this.generation;
    this.client?.dispose();
    this.client = undefined;
    this.identityValue = undefined;
    this.portAttachedAt = this.now();
    this.diagnosticEvidence.recordPortAttached(generation, handoff.hostEpoch);

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
    client.onTeardown((error, reason) => {
      this.handleTeardown(generation, client, error, reason);
    });

    void client.waitUntilReady().then((identity) => {
      if (generation !== this.generation || client !== this.client) return;
      this.identityValue = identity;
      this.diagnosticEvidence.recordHandshakeCompleted(generation, identity.hostEpoch);
      for (const subscriber of this.subscribers) subscriber.onConnected?.(identity);
    }).catch((error: unknown) => {
      this.handleTeardown(
        generation,
        client,
        error instanceof Error ? error : connectionError("Pi runtime service handshake failed."),
        "protocol-violation"
      );
    });
  }

  private handleTeardown(
    generation: number,
    client: AgentPortClient,
    error: Error,
    reason: RendererConnectionTeardownReason
  ): void {
    if (generation !== this.generation || client !== this.client) return;
    const connectionLifetimeMs = Math.max(0, this.now() - (this.portAttachedAt ?? this.now()));
    this.client = undefined;
    this.identityValue = undefined;
    this.portAttachedAt = undefined;
    this.recoveryDiagnostics.recordTeardown(error, reason, connectionLifetimeMs);
    this.diagnosticEvidence.recordPortClosed({ connectionGeneration: generation, durationMs: connectionLifetimeMs, error, reason });
    client.dispose();
    for (const subscriber of this.subscribers) subscriber.onTeardown?.(error);
  }
}

export const agentConnectionController = new AgentConnectionController();
