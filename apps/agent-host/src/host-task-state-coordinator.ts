import type { RuntimeStatus } from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  hasValidCommandContext,
  type AgentHostRuntimePoisonedMessage,
  type CommandResults,
  type ProtocolContext,
  type RequestEnvelope
} from "@pi67/protocol";
import { CommandScheduler } from "./command-scheduler.js";
import { ControlMutationLedger } from "./control-mutation-ledger.js";
import type { ExtensionPackageTaskView } from "./extension-package-command-router.js";
import { GlobalRunAdmission, type RunAdmissionLease } from "./global-run-admission.js";
import type { HostEventChannel } from "./host-event-channel.js";
import { OperationRegistry } from "./operation-registry.js";
import { OperationReceiptStore } from "./operation-receipt-store.js";
import { HostCommandError } from "./protocol-error.js";
import type { TaskRuntimeRecord, TaskRuntimeRegistry } from "./task-runtime-registry.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

export interface TaskHostState {
  readonly record: TaskRuntimeRecord;
  operations?: OperationRegistry;
  scheduler?: CommandScheduler;
  controlMutations?: ControlMutationLedger;
}

export interface HostTaskStateCoordinatorOptions {
  abortWatchdogMs?: number;
  operationHeartbeatIntervalMs?: number;
  operationReceiptStorageRoot?: string;
  maxQueuedCommands?: number;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
  getHostEpoch(): number;
  sendTaskEvent(
    state: TaskHostState,
    event: Parameters<HostEventChannel["send"]>[0]
  ): boolean;
}

export class HostTaskStateCoordinator {
  private readonly states = new Map<string, TaskHostState>();
  private readonly runAdmission = new GlobalRunAdmission();
  private activeTaskKey: string | undefined;

  constructor(
    private readonly taskRuntimes: TaskRuntimeRegistry,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly options: HostTaskStateCoordinatorOptions
  ) {}

  values(): TaskHostState[] {
    return [...this.states.values()];
  }

  activeState(): TaskHostState | undefined {
    return this.activeTaskKey === undefined ? undefined : this.states.get(this.activeTaskKey);
  }

  clear(): void {
    this.states.clear();
    this.activeTaskKey = undefined;
  }

  clearActiveTask(taskKey: string): void {
    if (this.activeTaskKey === taskKey) this.activeTaskKey = undefined;
  }

  authorizeRequestContext(request: RequestEnvelope): TaskHostState | undefined {
    const context = request.context;
    if (!hasValidCommandContext(request.type, context)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        `Command context scope is invalid: ${request.type}`,
        false
      );
    }
    if (context.scope === "app") {
      if (!allowsAppContext(request)) {
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          `Command requires Workspace or Task authority: ${request.type}`,
          false
        );
      }
      if (request.type === "runtime.getStatus") return this.activeState();
      return this.activeState() ?? this.values().find((candidate) => !candidate.record.closed);
    }
    if (context.scope === "workspace") {
      if (
        request.type === "workspace.register"
        || request.type === "workspace.unregister"
      ) {
        return undefined;
      }
      if (COMMAND_CONTEXT_SCOPE_REQUIREMENTS[request.type] !== "workspace") {
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          `Command requires Task authority: ${request.type}`,
          false
        );
      }
      this.workspaces.require(context.workspaceId);
      return undefined;
    }
    const record = this.taskRuntimes.admit(context);
    this.taskRuntimes.assertSessionAuthority(context);
    const state = this.stateForRecord(record);
    if (record.closed && request.type !== "task.close") {
      throw new HostCommandError("RUNTIME_NOT_READY", "The Task Runtime has been closed.", true);
    }
    this.activeTaskKey = record.taskKey;
    return state;
  }

  eventProtocolContext(): ProtocolContext {
    return this.activeState()?.record.context ?? APP_PROTOCOL_CONTEXT;
  }

  runtimeStatus(compatibilityRuntimeLoaded: boolean): CommandResults["runtime.getStatus"] {
    const records = this.taskRuntimes.values();
    return {
      initialized: records.some((record) => record.initialized && !record.closed),
      loaded: records.some((record) => record.runtime !== undefined && !record.closed)
        || compatibilityRuntimeLoaded
    };
  }

  requireState(state: TaskHostState | undefined): TaskHostState {
    if (state) return state;
    throw new HostCommandError("RUNTIME_NOT_READY", "No Task Runtime authority is available.", true);
  }

  requireOperations(state: TaskHostState): OperationRegistry {
    if (state.operations) return state.operations;
    state.operations = new OperationRegistry(
      this.options.getHostEpoch(),
      () => state.record.runtime?.getIdentity() ?? { sessionGeneration: 0 },
      (event) => this.sendEvent(state, event),
      {
        ...(this.options.abortWatchdogMs === undefined
          ? {}
          : { abortWatchdogMs: this.options.abortWatchdogMs }),
        ...(this.options.operationHeartbeatIntervalMs === undefined
          ? {}
          : { heartbeatIntervalMs: this.options.operationHeartbeatIntervalMs }),
        receiptStore: new OperationReceiptStore(
          {
            workspaceId: state.record.context.workspaceId,
            taskId: state.record.context.taskId,
            taskGeneration: state.record.context.taskGeneration
          },
          this.options.operationReceiptStorageRoot === undefined
            ? {}
            : { storageRoot: this.options.operationReceiptStorageRoot }
        ),
        onRuntimePoisoned: (message) => this.handleRuntimePoisoned(state, message)
      }
    );
    return state.operations;
  }

  requireScheduler(state: TaskHostState | undefined): CommandScheduler {
    const taskState = this.requireState(state);
    taskState.scheduler ??= new CommandScheduler(
      () => taskState.operations?.hasActive() ?? false,
      () => taskState.operations?.canAcceptQueue() ?? false,
      this.options.maxQueuedCommands === undefined
        ? {}
        : { maxQueuedCommands: this.options.maxQueuedCommands }
    );
    return taskState.scheduler;
  }

  requireControlMutationLedger(state: TaskHostState): ControlMutationLedger {
    state.controlMutations ??= new ControlMutationLedger(
      this.options.getHostEpoch(),
      () => state.record.runtime?.getIdentity() ?? { sessionGeneration: 0 }
    );
    return state.controlMutations;
  }

  bindRuntime(record: TaskRuntimeRecord, runtime: AgentRuntime): void {
    const state = this.stateForRecord(record);
    runtime.subscribe((event) => this.sendEvent(state, event));
    runtime.subscribeOperationActivity?.((activity) => state.operations?.updateActivity(activity));
  }

  sendStatus(state: TaskHostState, status: RuntimeStatus): void {
    this.sendEvent(state, { type: "runtime.statusChanged", payload: status });
  }

  sendEvent(
    state: TaskHostState,
    event: Parameters<HostEventChannel["send"]>[0]
  ): void {
    if (this.options.sendTaskEvent(state, event)) this.updateRunAdmissionFromEvent(state, event);
  }

  packageTaskViews(): ExtensionPackageTaskView[] {
    return this.values()
      .filter((state) => !state.record.closed)
      .map((state) => ({
        taskKey: state.record.taskKey,
        workspaceId: state.record.context.workspaceId,
        runtime: state.record.runtime,
        initialized: state.record.initialized,
        isIdle: () => !(state.operations?.hasActive() ?? false)
          && (state.scheduler?.isIdle() ?? true)
      }));
  }

  reserveRun(taskKey: string): RunAdmissionLease {
    return this.runAdmission.reserve(taskKey);
  }

  releaseRun(lease: RunAdmissionLease): void {
    this.runAdmission.release(lease);
  }

  releaseTaskRun(taskKey: string): void {
    this.runAdmission.releaseTask(taskKey);
  }

  private stateForRecord(record: TaskRuntimeRecord): TaskHostState {
    const existing = this.states.get(record.taskKey);
    if (existing?.record === record) return existing;
    const state: TaskHostState = { record };
    this.states.set(record.taskKey, state);
    return state;
  }

  private handleRuntimePoisoned(
    state: TaskHostState,
    message: AgentHostRuntimePoisonedMessage
  ): void {
    this.sendStatus(state, {
      phase: "recovering",
      detail: message.code === "ABORT_WATCHDOG_EXPIRED"
        ? "Pi Runtime 无法安全停止，正在替换 Pi 运行服务"
        : "Pi 导入会话投影无法恢复，正在替换 Pi 运行服务",
      recoverable: true
    });
    this.options.onRuntimePoisoned?.(message);
  }

  private updateRunAdmissionFromEvent(
    state: TaskHostState,
    event: Parameters<HostEventChannel["send"]>[0]
  ): void {
    if (event.type === "operation.started") {
      this.runAdmission.transition(state.record.taskKey, "running");
      return;
    }
    if (event.type === "approval.requested") {
      this.runAdmission.transition(state.record.taskKey, "waiting-approval");
      return;
    }
    if (event.type === "extension.ui.requested" && event.payload.blocking) {
      this.runAdmission.transition(state.record.taskKey, "waiting-extension-input");
      return;
    }
    if (
      event.type === "approval.resolved"
      || event.type === "approval.cancelled"
      || event.type === "extension.ui.resolved"
      || event.type === "extension.ui.cancelled"
    ) {
      this.runAdmission.transition(state.record.taskKey, "running");
      return;
    }
    if (
      event.type === "operation.completed"
      || event.type === "operation.failed"
      || event.type === "operation.cancelled"
      || event.type === "operation.lost"
    ) this.runAdmission.releaseTask(state.record.taskKey);
  }
}

function allowsAppContext(request: RequestEnvelope): boolean {
  return request.type === "runtime.getStatus"
    || request.type === "diagnostics.collect"
    || request.type === "doctor.run"
    || request.type === "lark.auth.status"
    || request.type === "lark.auth.login.begin"
    || request.type === "lark.app.configuration.save"
    || (
      request.type === "session.catalog.query"
      && (request as RequestEnvelope<"session.catalog.query">).payload.scope === "all"
    );
}
