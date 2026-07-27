import type { RuntimeStatus } from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  createMessageId,
  isReplaySafeControlMutation,
  type AgentCommand,
  type AgentCommandType,
  type AgentHostRuntimePoisonedMessage,
  type AgentHostShutdownCompleteMessage,
  type CommandResults,
  type ProtocolPort,
  type ReplaySafeControlMutationType,
  type RequestEnvelope
} from "@pi67/protocol";
import { CommandScheduler } from "./command-scheduler.js";
import { HostConnectionContext, type HostConnectionIdentity } from "./connection-context.js";
import { ControlMutationLedger } from "./control-mutation-ledger.js";
import {
  dispatchHostCommand,
  operationSubmissionIdentity,
  type RuntimeLoadedCommand
} from "./host-command-dispatcher.js";
import { HostEventChannel } from "./host-event-channel.js";
import {
  captureProjectionMutationAcknowledgement,
  captureProjectionResync
} from "./host-projection.js";
import { OperationRegistry } from "./operation-registry.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";
import { runtimeReadyEvent } from "./runtime-ready-event.js";

export interface AttachPortOptions {
  expectedOrigin?: string;
  appInstanceId?: string;
  hostInstanceId?: string;
  hostEpoch?: number;
}

export type AgentRuntimeLoader = () => Promise<AgentRuntime>;

export interface AgentHostServerOptions {
  abortWatchdogMs?: number;
  operationHeartbeatIntervalMs?: number;
  maxQueuedCommands?: number;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
}

export type AgentHostShutdownResult = Omit<AgentHostShutdownCompleteMessage, "type">;

const DEFAULT_SHUTDOWN_DEADLINE_MS = 4_000;
const MAX_RESYNC_INTERACTIVE_REQUESTS = 512;

export class AgentHostServer {
  private runtime: AgentRuntime | undefined;
  private runtimeLoad: Promise<AgentRuntime> | undefined;
  private currentConnection: HostConnectionContext | undefined;
  private operations: OperationRegistry | undefined;
  private scheduler: CommandScheduler | undefined;
  private controlMutations: ControlMutationLedger | undefined;
  private initialized = false;
  private hostIdentity: HostConnectionIdentity | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<AgentHostShutdownResult> | undefined;
  private readonly events: HostEventChannel;

  constructor(
    private readonly runtimeLoader: AgentRuntimeLoader = defaultRuntimeLoader,
    private readonly options: AgentHostServerOptions = {}
  ) {
    this.events = new HostEventChannel({
      getConnection: () => this.currentConnection,
      getHostEpoch: () => this.hostIdentity?.hostEpoch ?? 1,
      getOperations: () => this.operations,
      getRuntime: () => this.runtime
    });
  }

  attachPort(port: ProtocolPort, options: AttachPortOptions = {}): void {
    if (this.shuttingDown) {
      port.close?.();
      return;
    }
    const identity = this.resolveHostIdentity(options);
    const connection = new HostConnectionContext(
      port,
      identity,
      async () => {
        const runtime = await this.loadRuntime();
        return { sdkVersion: runtime.getSdkVersion(), eventSequence: this.events.eventSequence };
      },
      (origin, request) => this.handleRequest(origin, request),
      () => {
        if (this.currentConnection === connection) {
          this.runtime?.cancelInteractiveRequests("connection-close");
        }
      }
    );
    this.currentConnection?.retire();
    this.currentConnection = connection;
  }

  shutdown(deadlineMs = DEFAULT_SHUTDOWN_DEADLINE_MS): Promise<AgentHostShutdownResult> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.performShutdown(shutdownDeadline(deadlineMs));
    return this.shutdownPromise;
  }

  private handleRequest(origin: HostConnectionContext, request: RequestEnvelope): void {
    if (this.shuttingDown) {
      origin.sendError(request.requestId, request.type, toProtocolError(connectionClosed()));
      return;
    }
    if (request.type === "projection.resync") {
      const command = { type: request.type, payload: request.payload } as AgentCommand;
      void this.requireScheduler()
        .run(command, () => this.handleProjectionResync(origin, request as RequestEnvelope<"projection.resync">))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    if (request.type === "queue.clear") {
      const scheduler = this.requireScheduler();
      void scheduler.clearQueue(async () => {
        const runtime = await this.loadRuntime();
        return runtime.clearQueue();
      }).then(
        ({ pendingCount, result }) => origin.sendSuccess(request.requestId, request.type, {
          ...result,
          pendingCount
        }),
        (error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error))
      );
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand;
    const submission = operationSubmissionIdentity(command);
    if (submission) {
      let existing: ReturnType<OperationRegistry["submissionFor"]>;
      try {
        existing = this.operations?.submissionFor(submission.submissionId, submission.fingerprint);
      } catch (error) {
        origin.sendError(request.requestId, request.type, toProtocolError(error));
        return;
      }
      if (existing) {
        void Promise.resolve(existing).then(
          (accepted) => origin.sendSuccess(request.requestId, request.type, accepted),
          (error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error))
        );
        return;
      }
    }
    const scheduler = this.requireScheduler();
    if (isReplaySafeControlMutation(request.type)) {
      if (!request.idempotencyKey) {
        origin.sendError(request.requestId, request.type, {
          code: "INVALID_PAYLOAD",
          message: "Replay-safe control mutations require an idempotency key.",
          recoverable: false
        });
        return;
      }
      let result: Promise<CommandResults[AgentCommandType]>;
      try {
        const controlCommand = command as AgentCommand<ReplaySafeControlMutationType>;
        result = this.requireControlMutationLedger().run(
          request.idempotencyKey,
          controlCommand,
          () => scheduler.run(controlCommand, () => this.dispatch(controlCommand))
        );
      } catch (error) {
        origin.sendError(request.requestId, request.type, toProtocolError(error));
        return;
      }
      void result
        .then((response) => sendSuccess(origin, request, response))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    void scheduler.run(command, () => this.dispatch(command, submission?.fingerprint))
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private async dispatch(
    command: AgentCommand,
    submissionFingerprint?: string
  ): Promise<CommandResults[AgentCommandType]> {
    if (command.type === "runtime.getStatus") {
      return { initialized: this.initialized, loaded: this.runtime !== undefined };
    }
    const runtime = await this.loadRuntime();
    return dispatchHostCommand(runtime, command as RuntimeLoadedCommand, {
      captureProjectionResync: (activeRuntime) => this.captureProjectionResync(activeRuntime),
      captureProjectionMutationAcknowledgement: (activeRuntime) => (
        captureProjectionMutationAcknowledgement(
          activeRuntime,
          this.events.eventSequence,
          this.hostIdentity?.hostEpoch ?? 1
        )
      ),
      initializeRuntime: (activeRuntime, options) => this.initializeRuntime(activeRuntime, options),
      operations: () => this.requireOperations(),
      completeInteractiveWait: (requestId) => { this.operations?.completeInteractiveWait(requestId); },
      sendEvent: (event) => this.events.send(event)
    }, submissionFingerprint);
  }

  private async initializeRuntime(
    runtime: AgentRuntime,
    options: Parameters<AgentRuntime["initialize"]>[0]
  ): Promise<CommandResults["runtime.initialize"]> {
    this.sendStatus({ phase: "starting", detail: "正在加载 Pi SDK", recoverable: true });
    const snapshot = await runtime.initialize(options);
    this.initialized = true;
    this.sendStatus({ phase: "ready", detail: "Pi SDK 已就绪", recoverable: true });
    this.events.send(runtimeReadyEvent(runtime, snapshot));
    return captureProjectionMutationAcknowledgement(
      runtime,
      this.events.eventSequence,
      this.hostIdentity?.hostEpoch ?? 1
    );
  }

  private async loadRuntime(): Promise<AgentRuntime> {
    if (this.shuttingDown) throw connectionClosed();
    if (this.runtime) return this.runtime;
    this.runtimeLoad ??= this.runtimeLoader()
      .then((runtime) => {
        runtime.subscribe((event) => this.events.send(event));
        runtime.subscribeOperationActivity?.((activity) => this.operations?.updateActivity(activity));
        this.runtime = runtime;
        return runtime;
      })
      .catch((error: unknown) => {
        this.runtimeLoad = undefined;
        throw error;
      });
    return this.runtimeLoad;
  }

  private async performShutdown(deadlineMs: number): Promise<AgentHostShutdownResult> {
    const schedulerResult = this.scheduler?.shutdown() ?? { queuedCommandsDropped: 0 };
    const runtime = this.runtime ?? await this.runtimeLoad?.catch(() => undefined);
    const extensionRequestsCancelled = boundedMetadataCount(
      runtime?.cancelInteractiveRequests("runtime-dispose").length ?? 0
    );
    const activeOperation = await this.operations?.shutdown(
      "Cancelled because the application is shutting down.",
      Math.max(1, Math.min(this.options.abortWatchdogMs ?? deadlineMs, Math.floor(deadlineMs / 2)))
    ) ?? "none";

    try {
      await runtime?.dispose();
    } finally {
      this.currentConnection?.close();
      this.currentConnection = undefined;
      this.runtime = undefined;
      this.runtimeLoad = undefined;
      this.initialized = false;
    }
    return {
      activeOperation,
      queuedCommandsDropped: boundedMetadataCount(schedulerResult.queuedCommandsDropped),
      extensionRequestsCancelled
    };
  }

  private async handleProjectionResync(
    origin: HostConnectionContext,
    request: RequestEnvelope<"projection.resync">
  ): Promise<void> {
    const runtime = await this.loadRuntime();
    const cancelledRequestIds = runtime.cancelInteractiveRequests("projection-resync");
    const firstBoundedRequest = Math.max(0, cancelledRequestIds.length - MAX_RESYNC_INTERACTIVE_REQUESTS);
    for (let index = firstBoundedRequest; index < cancelledRequestIds.length; index += 1) {
      const requestId = cancelledRequestIds[index];
      if (requestId) this.operations?.completeInteractiveWait(requestId);
    }
    // Projection and sequence are captured before the synchronous response so later events stay ordered after it.
    origin.sendSuccess(request.requestId, request.type, this.captureProjectionResync(runtime));
  }

  private captureProjectionResync(runtime: AgentRuntime): CommandResults["projection.resync"] {
    return captureProjectionResync(
      runtime,
      this.events.eventSequence,
      this.hostIdentity?.hostEpoch ?? 1,
      this.operations
    );
  }

  private requireOperations(): OperationRegistry {
    if (this.operations) return this.operations;
    const hostEpoch = this.hostIdentity?.hostEpoch ?? 1;
    this.operations = new OperationRegistry(
      hostEpoch,
      () => this.runtime?.getIdentity() ?? { sessionGeneration: 0 },
      (event) => this.events.send(event),
      {
        ...(this.options.abortWatchdogMs === undefined ? {} : { abortWatchdogMs: this.options.abortWatchdogMs }),
        ...(this.options.operationHeartbeatIntervalMs === undefined
          ? {}
          : { heartbeatIntervalMs: this.options.operationHeartbeatIntervalMs }),
        onRuntimePoisoned: (message) => this.handleRuntimePoisoned(message)
      }
    );
    return this.operations;
  }

  private requireScheduler(): CommandScheduler {
    this.scheduler ??= new CommandScheduler(
      () => this.operations?.hasActive() ?? false,
      () => this.operations?.canAcceptQueue() ?? false,
      this.options.maxQueuedCommands === undefined
        ? {}
        : { maxQueuedCommands: this.options.maxQueuedCommands }
    );
    return this.scheduler;
  }

  private requireControlMutationLedger(): ControlMutationLedger {
    this.controlMutations ??= new ControlMutationLedger(
      this.hostIdentity?.hostEpoch ?? 1,
      () => this.runtime?.getIdentity() ?? { sessionGeneration: 0 }
    );
    return this.controlMutations;
  }

  private handleRuntimePoisoned(message: AgentHostRuntimePoisonedMessage): void {
    this.sendStatus({
      phase: "recovering",
      detail: message.code === "ABORT_WATCHDOG_EXPIRED"
        ? "Pi Runtime 无法安全停止，正在替换 Agent Host"
        : "Pi 导入会话投影无法恢复，正在替换 Agent Host",
      recoverable: true
    });
    this.options.onRuntimePoisoned?.(message);
  }

  private sendStatus(status: RuntimeStatus): void {
    this.events.send({ type: "runtime.statusChanged", payload: status });
  }

  private resolveHostIdentity(options: AttachPortOptions): HostConnectionIdentity {
    if (!this.hostIdentity) {
      this.hostIdentity = {
        ...(options.appInstanceId === undefined ? {} : { appInstanceId: options.appInstanceId }),
        hostInstanceId: options.hostInstanceId ?? process.env.PI67_HOST_INSTANCE_ID ?? createMessageId("host"),
        hostEpoch: options.hostEpoch ?? parseHostEpoch(process.env.PI67_HOST_EPOCH)
      };
      return this.hostIdentity;
    }
    return this.hostIdentity;
  }
}

function sendSuccess(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  result: CommandResults[AgentCommandType]
): void {
  origin.sendSuccess(request.requestId, request.type, result as never);
}

function parseHostEpoch(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 1;
}

async function defaultRuntimeLoader(): Promise<AgentRuntime> {
  const { PiSdkRuntime } = await import("@pi67/pi-runtime");
  return new PiSdkRuntime();
}

function connectionClosed(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "Agent Host is shutting down.",
    true,
    { shuttingDown: true }
  );
}

function shutdownDeadline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) {
    throw new RangeError("deadlineMs must be an integer between 100 and 10000.");
  }
  return value;
}

function boundedMetadataCount(value: number): number {
  return Math.max(0, Math.min(10_000, Number.isSafeInteger(value) ? value : 0));
}
