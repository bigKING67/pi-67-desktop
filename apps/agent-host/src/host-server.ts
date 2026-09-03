import { createRuntimeCredentialOverrideStore, PiConfigurationServiceRegistry, type AgentRuntime, type RuntimeCredentialOverrideStore } from "@pi67/pi-runtime";
import { createMessageId, type AgentCommand, type AgentCommandType, type CommandResults, type ProtocolPort, type RequestEnvelope } from "@pi67/protocol";
import { HostConnectionContext, type HostConnectionIdentity } from "./connection-context.js";
import { forkSessionFromTask } from "./cross-task-session-fork.js";
import { commandRequiresRunAdmission, isSettledRunAdmissionResult } from "./global-run-admission.js";
import { dispatchHostCommand, type RuntimeLoadedCommand } from "./host-command-dispatcher.js";
import { dispatchHostAppCommand } from "./host-app-command-dispatcher.js";
import { HostEventChannel } from "./host-event-channel.js";
import { HostDiagnosticEvidence } from "./host-diagnostic-evidence.js";
import { HostRequestRouter } from "./host-request-router.js";
import { collectHostRuntimeDiagnostics } from "./host-runtime-diagnostics.js";
import { defaultRuntimeLoader, parseHostEpoch } from "./host-runtime-loader.js";
import type { AgentHostServerOptions, AgentHostShutdownResult, AgentRuntimeLoader, AttachPortOptions } from "./host-server-contract.js";
import { HostSdkVersionLoader } from "./host-sdk-version-loader.js";
import { createHostSessionWriterLeaseRegistry } from "./host-session-writer-leases.js";
import { boundedMetadataCount, DEFAULT_HOST_SHUTDOWN_DEADLINE_MS, MAX_RESYNC_INTERACTIVE_REQUESTS, shutdownDeadline } from "./host-shutdown-contract.js";
import { HostTaskStateCoordinator, type TaskHostState } from "./host-task-state-coordinator.js";
import { HostTaskRuntimeLifecycle, resolveAgentDirectory } from "./host-task-runtime-lifecycle.js";
import { captureProjectionMutationAcknowledgement, captureProjectionResync } from "./host-projection.js";
import { createLarkAuthManagement, type LarkAuthManagementPort } from "./lark-auth-management.js";
import { createResourceManagementRouters, type ResourceManagementRouters } from "./resource-management-routers.js";
import type { SessionWriterLeaseRegistry, SessionWriterLeaseReservation } from "./session-writer-lease-registry.js";
import { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import { WorkspaceCommandRouter } from "./workspace-command-router.js";
import { WorkspaceContextRegistry } from "./workspace-context-registry.js";
import { WorkspaceFileCommandRouter } from "./workspace-file-command-router.js";
import { AppConfigurationCommandRouter } from "./app-configuration-command-router.js";
import { ContextMemoryCommandRouter } from "./context/context-memory-command-router.js";
export type { AgentHostServerOptions, AgentHostShutdownResult, AgentRuntimeLoader, AttachPortOptions } from "./host-server-contract.js";
export class AgentHostServer {
  private currentConnection: HostConnectionContext | undefined;
  private compatibilityRuntime: AgentRuntime | undefined;
  private compatibilityRuntimeLoad: Promise<AgentRuntime> | undefined;
  private compatibilityRuntimeUnsubscribe: (() => void) | undefined;
  private readonly workspaces: WorkspaceContextRegistry;
  private readonly appConfiguration: AppConfigurationCommandRouter;
  private readonly contextMemory: ContextMemoryCommandRouter;
  private readonly sessionWriterLeases: SessionWriterLeaseRegistry;
  private readonly workspaceCommands: WorkspaceCommandRouter;
  private readonly workspaceFiles: WorkspaceFileCommandRouter;
  private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore;
  private readonly taskRuntimes: TaskRuntimeRegistry;
  private readonly contextFiles: ResourceManagementRouters["contextFiles"];
  private readonly extensionPackages: ResourceManagementRouters["extensionPackages"];
  private readonly skillPacks: ResourceManagementRouters["skillPacks"];
  private readonly larkAuth: LarkAuthManagementPort;
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
  private readonly diagnosticEvidence = new HostDiagnosticEvidence();
  constructor(runtimeLoader?: AgentRuntimeLoader, private readonly options: AgentHostServerOptions = {}) {
    this.runtimeLoader = runtimeLoader ?? defaultRuntimeLoader;
    this.usesCompatibilityRuntime = runtimeLoader !== undefined && options.sdkVersionLoader === undefined;
    const configurationServices = options.configurationServices ?? new PiConfigurationServiceRegistry();
    const agentDir = options.agentDir ?? resolveAgentDirectory(undefined);
    const configuration = configurationServices.acquire(agentDir);
    configuration.prewarmModelRuntime();
    this.workspaces = new WorkspaceContextRegistry({ configurationServices });
    this.appConfiguration = new AppConfigurationCommandRouter(configuration);
    this.sessionWriterLeases = options.sessionWriterLeaseRegistry
      ?? createHostSessionWriterLeaseRegistry(() => this.hostIdentity, options.onRuntimePoisoned);
    this.runtimeCredentialOverrides = options.runtimeCredentialOverrides
      ?? createRuntimeCredentialOverrideStore();
    this.taskRuntimes = new TaskRuntimeRegistry(
      this.runtimeLoader,
      this.runtimeCredentialOverrides,
      {
        onRuntimeLoaded: (record, runtime) => this.tasks.bindRuntime(record, runtime),
        sharedExperienceAccessForWorkspace: (workspaceId) => this.contextMemory.sharedExperienceAccess(workspaceId),
        sharedSopAccessForWorkspace: (workspaceId) => this.contextMemory.sharedSopAccess(workspaceId)
      },
      this.options.promptAttachments
    );
    this.tasks = new HostTaskStateCoordinator(this.taskRuntimes, this.workspaces, {
      ...(this.options.abortWatchdogMs === undefined ? {} : { abortWatchdogMs: this.options.abortWatchdogMs }),
      ...(this.options.operationHeartbeatIntervalMs === undefined
        ? {}
        : { operationHeartbeatIntervalMs: this.options.operationHeartbeatIntervalMs }),
      ...((this.options.operationReceiptStorageRoot ?? process.env.PI67_STORAGE_ROOT) === undefined ? {} : {
        operationReceiptStorageRoot: this.options.operationReceiptStorageRoot ?? process.env.PI67_STORAGE_ROOT!
      }),
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
      ...(this.options.packageWorker === undefined
        ? {}
        : { packageWorker: this.options.packageWorker }),
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
    this.larkAuth = this.options.larkAuthManagement ?? createLarkAuthManagement();
    this.events = new HostEventChannel({
      getConnection: () => this.currentConnection,
      getHostEpoch: () => this.hostIdentity?.hostEpoch ?? 1,
      getOperations: () => this.tasks.activeState()?.operations,
      getRuntime: () => this.tasks.activeState()?.record.runtime ?? this.compatibilityRuntime,
      getProtocolContext: () => this.tasks.eventProtocolContext()
    });
    this.contextMemory = new ContextMemoryCommandRouter(
      agentDir, this.workspaces, this.events, this.options.enterpriseCredentialBroker
    );
    this.appConfiguration.bindEvents(this.events);
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
      this.contextMemory,
      this.extensionPackages,
      this.skillPacks,
      this.workspaceCommands,
      this.workspaceFiles,
      {
        isShuttingDown: () => this.shuttingDown,
        runtimeStatus: () => this.tasks.runtimeStatus(this.compatibilityRuntime !== undefined),
        dispatchAppCommand: (command, idempotencyKey) => dispatchHostAppCommand(command, {
          appConfiguration: this.appConfiguration,
          contextMemory: this.contextMemory,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          larkAuth: this.larkAuth,
          loadRuntime: async () => this.tasks.activeState()?.record.runtime ?? this.loadCompatibilityRuntime(),
          collectDiagnostics: (runtime) => collectHostRuntimeDiagnostics({
            runtime,
            hostEpoch: this.hostIdentity?.hostEpoch ?? 0,
            taskStates: this.tasks.values(),
            workspaceRecords: this.workspaces.values(),
            writerLeases: this.sessionWriterLeases,
            diagnosticEvidence: this.diagnosticEvidence
          })
        }),
        handleProjectionResync: (origin, request, state) => this.handleProjectionResync(origin, request, state),
        loadRuntime: (state) => this.taskLifecycle.loadRuntime(state),
        closeTask: (state, mode) => this.taskLifecycle.closeTask(state, mode),
        dispatchTask: (command, state, fingerprint) => this.dispatch(command, state, fingerprint),
        shutdownResources: async (deadlineMs) => {
          const results = await Promise.allSettled([
            resourceManagement.shutdown(deadlineMs),
            this.larkAuth.shutdown(),
            this.contextMemory.shutdown(),
            this.appConfiguration.shutdown()
          ]);
          const rejected = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected"
          );
          if (rejected) throw rejected.reason;
        }
      }
    );
  }
  attachPort(port: ProtocolPort, options: AttachPortOptions = {}): void {
    if (this.shuttingDown) {
      port.close?.();
      return;
    }
    const identity = this.resolveHostIdentity(options);
    const connectionSequence = this.diagnosticEvidence.attach(identity.hostEpoch);
    const connection = new HostConnectionContext(
      port,
      identity,
      async () => {
        const sdkVersion = await this.sdkVersions.load();
        if (this.options.modelCatalogRefreshOnStartup ?? process.env.NODE_ENV !== "test") this.appConfiguration.startBackgroundModelCatalogRefresh();
        return { sdkVersion, eventSequence: this.events.eventSequence };
      },
      (origin, request) => this.requests.handle(origin, request),
      () => {
        if (this.currentConnection === connection) {
          for (const record of this.taskRuntimes.values()) {
            record.runtime?.cancelInteractiveRequests("connection-close");
          }
          this.compatibilityRuntime?.cancelInteractiveRequests("connection-close");
        }
      },
      2_048,
      256,
      {
        connectionSequence,
        record: (incident) => this.diagnosticEvidence.record(incident)
      }
    );
    this.currentConnection?.retire();
    this.currentConnection = connection;
  }
  shutdown(deadlineMs = DEFAULT_HOST_SHUTDOWN_DEADLINE_MS): Promise<AgentHostShutdownResult> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.performShutdown(shutdownDeadline(deadlineMs));
    return this.shutdownPromise;
  }
  private async dispatch(
    command: AgentCommand, state: TaskHostState, submissionFingerprint?: string
  ): Promise<CommandResults[AgentCommandType]> {
    if (command.type === "task.close") return this.taskLifecycle.closeTask(state, command.payload.mode);
    if (command.type === "prompt.submit" && command.payload.workspaceFiles?.length) {
      await this.workspaceFiles.validatePromptReferences(
        state.record.context.workspaceId,
        command.payload.workspaceFiles
      );
    }
    const initializedBeforeCommand = state.record.initialized;
    const runtime = await this.taskLifecycle.loadRuntimeForCommand(state, command);
    const admissionLease = commandRequiresRunAdmission(command)
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
      if (admissionLease && isSettledRunAdmissionResult(result)) this.tasks.releaseRun(admissionLease);
      return result;
    } catch (error) {
      const failure = await this.taskLifecycle.cancelWriterTransitionAfterFailure(writerReservation, error);
      if (admissionLease) this.tasks.releaseRun(admissionLease);
      throw failure;
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
    let firstError: unknown;
    const rememberError = (error: unknown): void => { firstError ??= error; };
    const resourceShutdownBudget = Math.max(20, Math.min(750, Math.floor(deadlineMs / 4)));
    // Package-tree termination and resource-command fencing must not consume the
    // window needed to abort Pi operations and release JSONL writers.
    const requestShutdown = this.requests.shutdown(resourceShutdownBudget).catch(rememberError);
    const connectionCloseRuntimes = new Set(this.taskRuntimes.values()
      .map((record) => record.runtime)
      .filter((runtime): runtime is AgentRuntime => runtime !== undefined));
    if (this.compatibilityRuntime) connectionCloseRuntimes.add(this.compatibilityRuntime);
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
    const writerRuntimesDisposed = await this.taskLifecycle.disposeAllForShutdown(rememberError);
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
    await this.taskLifecycle.releaseWriterLeasesForShutdown(writerRuntimesDisposed, rememberError);
    await requestShutdown;
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
    await this.tasks.requireOperations(state).reconcile();
    // Projection and sequence are captured before the synchronous response so later events stay ordered after it.
    origin.sendSuccess(request.requestId, request.type, this.captureProjectionResync(runtime, state));
  }
  private captureProjectionResync(runtime: AgentRuntime, state: TaskHostState): CommandResults["projection.resync"] {
    const hostEpoch = this.hostIdentity?.hostEpoch ?? 1;
    return captureProjectionResync(runtime, this.events.eventSequence, hostEpoch, state.operations);
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
