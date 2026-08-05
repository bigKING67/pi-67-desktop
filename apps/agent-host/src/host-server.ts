import {
  createRuntimeCredentialOverrideStore,
  type AgentRuntime,
  type RuntimeCredentialOverrideStore
} from "@pi67/pi-runtime";
import {
  createMessageId,
  type AgentCommand,
  type AgentCommandType,
  type CommandResults,
  type ProtocolPort,
  type RequestEnvelope
} from "@pi67/protocol";
import { HostConnectionContext, type HostConnectionIdentity } from "./connection-context.js";
import { forkSessionFromTask } from "./cross-task-session-fork.js";
import { dispatchHostCommand, type RuntimeLoadedCommand } from "./host-command-dispatcher.js";
import { HostEventChannel } from "./host-event-channel.js";
import { HostRequestRouter } from "./host-request-router.js";
import { defaultRuntimeLoader, parseHostEpoch } from "./host-runtime-loader.js";
import type { AgentHostServerOptions, AgentHostShutdownResult, AgentRuntimeLoader, AttachPortOptions } from "./host-server-contract.js";
import { HostSdkVersionLoader } from "./host-sdk-version-loader.js";
import { boundedMetadataCount, shutdownDeadline } from "./host-shutdown-contract.js";
import { HostTaskStateCoordinator, type TaskHostState } from "./host-task-state-coordinator.js";
import { HostTaskRuntimeLifecycle } from "./host-task-runtime-lifecycle.js";
import {
  captureProjectionMutationAcknowledgement,
  captureProjectionResync
} from "./host-projection.js";
import { HostCommandError } from "./protocol-error.js";
import { createResourceManagementRouters, type ResourceManagementRouters } from "./resource-management-routers.js";
import { SessionWriterLeaseRegistry, type SessionWriterLeaseReservation } from "./session-writer-lease-registry.js";
import { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import { WorkspaceCommandRouter } from "./workspace-command-router.js";
import { WorkspaceContextRegistry } from "./workspace-context-registry.js";
import { WorkspaceFileCommandRouter } from "./workspace-file-command-router.js";
export type {
  AgentHostServerOptions,
  AgentHostShutdownResult,
  AgentRuntimeLoader,
  AttachPortOptions
} from "./host-server-contract.js";

const DEFAULT_SHUTDOWN_DEADLINE_MS = 4_000;
const MAX_RESYNC_INTERACTIVE_REQUESTS = 512;
export class AgentHostServer {
  private currentConnection: HostConnectionContext | undefined;
  private compatibilityRuntime: AgentRuntime | undefined;
  private compatibilityRuntimeLoad: Promise<AgentRuntime> | undefined;
  private compatibilityRuntimeUnsubscribe: (() => void) | undefined;
  private readonly workspaces = new WorkspaceContextRegistry();
  private readonly sessionWriterLeases = new SessionWriterLeaseRegistry();
  private readonly workspaceCommands: WorkspaceCommandRouter;
  private readonly workspaceFiles: WorkspaceFileCommandRouter;
  private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore;
  private readonly taskRuntimes: TaskRuntimeRegistry;
  private readonly contextFiles: ResourceManagementRouters["contextFiles"];
  private readonly extensionPackages: ResourceManagementRouters["extensionPackages"];
  private readonly skillPacks: ResourceManagementRouters["skillPacks"];
  private readonly tasks: HostTaskStateCoordinator;
  private readonly taskLifecycle: HostTaskRuntimeLifecycle;
  private readonly requests: HostRequestRouter;
  private hostIdentity: HostConnectionIdentity | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<AgentHostShutdownResult> | undefined;
  private readonly sdkVersions: HostSdkVersionLoader;
  private readonly events: HostEventChannel;
  private readonly runtimeLoader: AgentRuntimeLoader;
  private readonly usesCompatibilityRuntime: boolean;

  constructor(
    runtimeLoader?: AgentRuntimeLoader,
    private readonly options: AgentHostServerOptions = {}
  ) {
    this.runtimeLoader = runtimeLoader ?? defaultRuntimeLoader;
    this.usesCompatibilityRuntime = runtimeLoader !== undefined && options.sdkVersionLoader === undefined;
    this.runtimeCredentialOverrides = options.runtimeCredentialOverrides
      ?? createRuntimeCredentialOverrideStore();
    this.taskRuntimes = new TaskRuntimeRegistry(
      this.runtimeLoader,
      this.runtimeCredentialOverrides,
      { onRuntimeLoaded: (record, runtime) => this.tasks.bindRuntime(record, runtime) },
      this.options.promptAttachments
    );
    this.tasks = new HostTaskStateCoordinator(this.taskRuntimes, this.workspaces, {
      ...(this.options.abortWatchdogMs === undefined ? {} : { abortWatchdogMs: this.options.abortWatchdogMs }),
      ...(this.options.operationHeartbeatIntervalMs === undefined
        ? {}
        : { operationHeartbeatIntervalMs: this.options.operationHeartbeatIntervalMs }),
      ...(this.options.maxQueuedCommands === undefined
        ? {}
        : { maxQueuedCommands: this.options.maxQueuedCommands }),
      ...(this.options.onRuntimePoisoned === undefined
        ? {}
        : { onRuntimePoisoned: this.options.onRuntimePoisoned }),
      getHostEpoch: () => this.hostIdentity?.hostEpoch ?? 1,
      sendTaskEvent: (state, event) => this.events.sendFor(event, {
        runtime: state.record.runtime,
        operations: state.operations,
        context: state.record.context
      })
    });
    const resourceManagement = createResourceManagementRouters({
      getWorkspaceServices: (workspaceId) => this.workspaces.require(workspaceId).workspaceServices,
      listTasks: () => this.tasks.packageTaskViews(),
      ...(this.options.extensionPackageManagementFactory === undefined
        ? {}
        : { extensionPackageManagementFactory: this.options.extensionPackageManagementFactory }),
      ...(this.options.contextFileManagementFactory === undefined
        ? {}
        : { contextFileManagementFactory: this.options.contextFileManagementFactory }),
      ...(this.options.skillPackManagementFactory === undefined
        ? {}
        : { skillPackManagementFactory: this.options.skillPackManagementFactory })
    });
    this.contextFiles = resourceManagement.contextFiles;
    this.extensionPackages = resourceManagement.extensionPackages;
    this.skillPacks = resourceManagement.skillPacks;
    this.events = new HostEventChannel({
      getConnection: () => this.currentConnection,
      getHostEpoch: () => this.hostIdentity?.hostEpoch ?? 1,
      getOperations: () => this.tasks.activeState()?.operations,
      getRuntime: () => this.tasks.activeState()?.record.runtime ?? this.compatibilityRuntime,
      getProtocolContext: () => this.tasks.eventProtocolContext()
    });
    this.workspaceCommands = new WorkspaceCommandRouter(
      this.workspaces,
      this.taskRuntimes,
      this.runtimeCredentialOverrides,
      this.events,
      this.sessionWriterLeases
    );
    this.workspaceFiles = new WorkspaceFileCommandRouter(this.workspaces);
    this.sdkVersions = new HostSdkVersionLoader({
      runtimeLoader: this.runtimeLoader,
      runtimeCredentialOverrides: this.runtimeCredentialOverrides,
      usesCompatibilityRuntime: this.usesCompatibilityRuntime,
      loadCompatibilityRuntime: () => this.loadCompatibilityRuntime(),
      ...(this.options.sdkVersionLoader === undefined ? {} : { sdkVersionLoader: this.options.sdkVersionLoader })
    });
    this.taskLifecycle = new HostTaskRuntimeLifecycle(this.taskRuntimes, this.workspaces, this.tasks, {
      ...(this.options.abortWatchdogMs === undefined ? {} : { abortWatchdogMs: this.options.abortWatchdogMs }),
      getEventSequence: () => this.events.eventSequence,
      getHostEpoch: () => this.hostIdentity?.hostEpoch ?? 1,
      isShuttingDown: () => this.shuttingDown,
      usesCompatibilityRuntime: () => this.usesCompatibilityRuntime,
      takeCompatibilityRuntime: () => this.takeCompatibilityRuntime(),
      ...(this.options.onRuntimeInitializationObservation === undefined ? {} : { onRuntimeInitializationObservation: this.options.onRuntimeInitializationObservation })
    }, this.sessionWriterLeases);
    this.requests = new HostRequestRouter(
      this.tasks,
      this.contextFiles,
      this.extensionPackages,
      this.skillPacks,
      this.workspaceCommands,
      this.workspaceFiles,
      {
        isShuttingDown: () => this.shuttingDown,
        runtimeStatus: () => this.tasks.runtimeStatus(this.compatibilityRuntime !== undefined),
        dispatchAppCommand: (command) => this.dispatchAppCommand(command),
        handleProjectionResync: (origin, request, state) => this.handleProjectionResync(origin, request, state),
        loadRuntime: (state) => this.taskLifecycle.loadRuntime(state),
        closeTask: (state, mode) => this.taskLifecycle.closeTask(state, mode),
        dispatchTask: (command, state, fingerprint) => this.dispatch(command, state, fingerprint)
      }
    );
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
        return { sdkVersion: await this.sdkVersions.load(), eventSequence: this.events.eventSequence };
      },
      (origin, request) => this.requests.handle(origin, request),
      () => {
        if (this.currentConnection === connection) {
          for (const record of this.taskRuntimes.values()) {
            record.runtime?.cancelInteractiveRequests("connection-close");
          }
          this.compatibilityRuntime?.cancelInteractiveRequests("connection-close");
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

  private async dispatch(
    command: AgentCommand, state: TaskHostState, submissionFingerprint?: string
  ): Promise<CommandResults[AgentCommandType]> {
    if (command.type === "task.close") return this.taskLifecycle.closeTask(state, command.payload.mode);
    const initializedBeforeCommand = state.record.initialized;
    const runtime = await this.taskLifecycle.loadRuntimeForCommand(state, command);
    const admissionLease = consumesRunAdmission(command)
      ? this.tasks.reserveRun(state.record.taskKey)
      : undefined;
    let writerReservation: SessionWriterLeaseReservation | undefined;
    try {
      writerReservation = await this.taskLifecycle.reserveWriterTransition(state, command);
      const result = await dispatchHostCommand(runtime, command as RuntimeLoadedCommand, {
        captureProjectionResync: (activeRuntime) => this.captureProjectionResync(activeRuntime, state),
        captureProjectionMutationAcknowledgement: (activeRuntime) => (
          captureProjectionMutationAcknowledgement(
            activeRuntime,
            this.events.eventSequence,
            this.hostIdentity?.hostEpoch ?? 1
          )
        ),
        initializeRuntime: (activeRuntime, options) => this.taskLifecycle.initializeRuntime(
          state,
          activeRuntime,
          options,
          () => this.taskLifecycle.commitWriterTransition(state, activeRuntime, writerReservation)
        ),
        forkSessionFromTask: (activeRuntime, payload) => forkSessionFromTask(
          this.tasks,
          state,
          activeRuntime,
          payload
        ),
        commitSessionWriter: (activeRuntime) => (
          this.taskLifecycle.commitWriterTransition(state, activeRuntime, writerReservation)
        ),
        operations: () => this.tasks.requireOperations(state),
        completeInteractiveWait: (requestId) => { state.operations?.completeInteractiveWait(requestId); },
        reuseInitializedSessionForCreate: command.type === "session.create" && !initializedBeforeCommand && state.record.initialized,
        sendEvent: (event) => this.tasks.sendEvent(state, event)
      }, submissionFingerprint);
      if (admissionLease && isSettledSubmission(result)) this.tasks.releaseRun(admissionLease);
      return result;
    } catch (error) {
      if (writerReservation) this.taskLifecycle.cancelWriterTransition(writerReservation);
      if (admissionLease) this.tasks.releaseRun(admissionLease);
      throw error;
    }
  }

  private loadCompatibilityRuntime(): Promise<AgentRuntime> {
    if (this.compatibilityRuntime) return Promise.resolve(this.compatibilityRuntime);
    this.compatibilityRuntimeLoad ??= this.runtimeLoader({
      runtimeCredentialOverrides: this.runtimeCredentialOverrides,
      ...(this.options.promptAttachments === undefined
        ? {}
        : { promptAttachmentAccess: this.options.promptAttachments.forTask("compatibility") })
    }).then((runtime) => {
      this.compatibilityRuntime = runtime;
      this.compatibilityRuntimeUnsubscribe = runtime.subscribe((event) => this.events.send(event));
      return runtime;
    }).catch((error: unknown) => {
      this.compatibilityRuntimeLoad = undefined;
      throw error;
    });
    return this.compatibilityRuntimeLoad;
  }

  private takeCompatibilityRuntime(): AgentRuntime | undefined {
    if (!this.compatibilityRuntime || !this.usesCompatibilityRuntime) return undefined;
    const runtime = this.compatibilityRuntime;
    this.compatibilityRuntimeUnsubscribe?.();
    this.compatibilityRuntimeUnsubscribe = undefined;
    this.compatibilityRuntime = undefined;
    this.compatibilityRuntimeLoad = undefined;
    return runtime;
  }

  private async performShutdown(deadlineMs: number): Promise<AgentHostShutdownResult> {
    this.requests.shutdown();
    const connectionCloseRuntimes = new Set(this.taskRuntimes.values()
      .map((record) => record.runtime)
      .filter((runtime): runtime is AgentRuntime => runtime !== undefined));
    if (this.compatibilityRuntime) connectionCloseRuntimes.add(this.compatibilityRuntime);
    let firstError: unknown;
    const rememberError = (error: unknown): void => { firstError ??= error; };
    let queuedCommandsDropped = 0;
    for (const state of this.tasks.values()) {
      queuedCommandsDropped += state.scheduler?.shutdown().queuedCommandsDropped ?? 0;
    }
    let extensionRequestsCancelled = 0;
    for (const record of this.taskRuntimes.values()) {
      try {
        extensionRequestsCancelled += record.runtime
          ?.cancelInteractiveRequests("runtime-dispose").length ?? 0;
      } catch (error) {
        rememberError(error);
      }
    }
    try {
      extensionRequestsCancelled += this.compatibilityRuntime
        ?.cancelInteractiveRequests("runtime-dispose").length ?? 0;
    } catch (error) {
      rememberError(error);
    }

    const operationResults = await Promise.all(this.tasks.values().map(async (state) => (
      state.operations?.shutdown(
        "Cancelled because the application is shutting down.",
        Math.max(1, Math.min(this.options.abortWatchdogMs ?? deadlineMs, Math.floor(deadlineMs / 2)))
      ).catch((error: unknown) => {
        rememberError(error);
        return "lost" as const;
      }) ?? "none"
    )));
    const activeOperation = operationResults.includes("lost")
      ? "lost"
      : operationResults.includes("cancelled") ? "cancelled" : "none";

    try {
      await this.taskRuntimes.disposeAll();
    } catch (error) {
      rememberError(error);
    }

    let compatibilityRuntime = this.compatibilityRuntime;
    if (!compatibilityRuntime && this.compatibilityRuntimeLoad) {
      try {
        compatibilityRuntime = await this.compatibilityRuntimeLoad;
        connectionCloseRuntimes.add(compatibilityRuntime);
      } catch (error) {
        rememberError(error);
      }
    }
    try {
      this.compatibilityRuntimeUnsubscribe?.();
    } catch (error) {
      rememberError(error);
    }
    this.compatibilityRuntimeUnsubscribe = undefined;
    try {
      await compatibilityRuntime?.dispose();
    } catch (error) {
      rememberError(error);
    }
    this.compatibilityRuntime = undefined;
    this.compatibilityRuntimeLoad = undefined;

    try {
      await this.workspaces.disposeAll();
    } catch (error) {
      rememberError(error);
    }
    try {
      await this.runtimeCredentialOverrides.clear();
    } catch (error) {
      rememberError(error);
    }
    try {
      await this.options.promptAttachments?.dispose();
    } catch (error) {
      rememberError(error);
    }
    for (const runtime of connectionCloseRuntimes) {
      try {
        runtime.cancelInteractiveRequests("connection-close");
      } catch (error) {
        rememberError(error);
      }
    }
    try {
      this.currentConnection?.close();
    } catch (error) {
      rememberError(error);
    }
    this.currentConnection = undefined;
    this.tasks.clear();
    if (firstError !== undefined) throw firstError;
    return {
      activeOperation,
      queuedCommandsDropped: boundedMetadataCount(queuedCommandsDropped),
      extensionRequestsCancelled: boundedMetadataCount(extensionRequestsCancelled)
    };
  }

  private async handleProjectionResync(
    origin: HostConnectionContext,
    request: RequestEnvelope<"projection.resync">,
    state: TaskHostState
  ): Promise<void> {
    const runtime = await this.taskLifecycle.projectionRuntime(state);
    const cancelledRequestIds = runtime.cancelInteractiveRequests("projection-resync");
    const firstBoundedRequest = Math.max(0, cancelledRequestIds.length - MAX_RESYNC_INTERACTIVE_REQUESTS);
    for (let index = firstBoundedRequest; index < cancelledRequestIds.length; index += 1) {
      const requestId = cancelledRequestIds[index];
      if (requestId) state.operations?.completeInteractiveWait(requestId);
    }
    // Projection and sequence are captured before the synchronous response so later events stay ordered after it.
    origin.sendSuccess(request.requestId, request.type, this.captureProjectionResync(runtime, state));
  }

  private captureProjectionResync(
    runtime: AgentRuntime,
    state: TaskHostState
  ): CommandResults["projection.resync"] {
    return captureProjectionResync(
      runtime,
      this.events.eventSequence,
      this.hostIdentity?.hostEpoch ?? 1,
      state.operations
    );
  }

  private async dispatchAppCommand(
    command: AgentCommand
  ): Promise<CommandResults[AgentCommandType]> {
    const runtime = this.tasks.activeState()?.record.runtime ?? await this.loadCompatibilityRuntime();
    switch (command.type) {
      case "diagnostics.collect":
        return runtime.collectDiagnostics();
      case "doctor.run":
        return runtime.runDoctor();
      case "session.catalog.query":
        return runtime.querySessionCatalog(command.payload);
      default:
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          `Command does not support App authority: ${command.type}`,
          false
        );
    }
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

function consumesRunAdmission(command: AgentCommand): boolean {
  return command.type === "session.import"
    || command.type === "session.compact"
    || command.type === "command.invoke"
    || (command.type === "prompt.submit" && command.payload.delivery === "new-turn");
}

function isSettledSubmission(result: CommandResults[AgentCommandType]): boolean {
  return typeof result === "object"
    && result !== null
    && "kind" in result
    && result.kind === "settled";
}
