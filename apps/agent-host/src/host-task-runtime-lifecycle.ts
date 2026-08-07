import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentRuntime,
  RuntimeInitializationObservation,
  RuntimeInitializationStage
} from "@pi67/pi-runtime";
import type { AgentCommand, CommandResults } from "@pi67/protocol";
import { captureProjectionMutationAcknowledgement } from "./host-projection.js";
import type {
  HostTaskStateCoordinator,
  TaskHostState
} from "./host-task-state-coordinator.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";
import { runtimeReadyEvent } from "./runtime-ready-event.js";
import {
  SessionWriterLeaseRegistry,
  type SessionWriterLeaseReservation
} from "./session-writer-lease-registry.js";
import type { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

export interface HostTaskRuntimeLifecycleOptions {
  abortWatchdogMs?: number;
  getEventSequence(): number;
  getHostEpoch(): number;
  isShuttingDown(): boolean;
  usesCompatibilityRuntime(): boolean;
  takeCompatibilityRuntime(): AgentRuntime | undefined;
  onRuntimeInitializationObservation?: (observation: RuntimeInitializationObservation) => void;
}

export class HostTaskRuntimeLifecycle {
  constructor(
    private readonly taskRuntimes: TaskRuntimeRegistry,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly tasks: HostTaskStateCoordinator,
    private readonly options: HostTaskRuntimeLifecycleOptions,
    private readonly sessionWriterLeases = new SessionWriterLeaseRegistry()
  ) {}

  async initializeRuntime(
    state: TaskHostState,
    runtime: AgentRuntime,
    options: Parameters<AgentRuntime["initialize"]>[0],
    commitSessionWriter: () => Promise<void> = () => this.commitWriterTransition(state, runtime)
  ): Promise<CommandResults["runtime.initialize"]> {
    this.tasks.sendStatus(state, { phase: "starting", detail: "正在加载 Pi SDK", recoverable: true });
    try {
      const snapshot = await runtime.initialize(options, (observation) => {
        this.options.onRuntimeInitializationObservation?.(observation);
        if (observation.outcome === "started") {
          this.tasks.sendStatus(state, {
            phase: "starting",
            detail: initializationStageDetail(observation.stage),
            recoverable: true
          });
        }
      });
      state.record.initialized = true;
      await commitSessionWriter();
      this.tasks.sendStatus(state, { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true });
      this.tasks.sendEvent(state, runtimeReadyEvent(runtime, snapshot));
      return captureProjectionMutationAcknowledgement(
        runtime,
        this.options.getEventSequence(),
        this.options.getHostEpoch()
      );
    } catch (error) {
      state.record.initialized = false;
      const failure = toProtocolError(error);
      this.tasks.sendStatus(state, {
        phase: "failed",
        detail: `Pi SDK 初始化失败：${failure.message}`,
        recoverable: failure.recoverable
      });
      throw error;
    }
  }

  async loadRuntimeForCommand(
    state: TaskHostState,
    command: AgentCommand
  ): Promise<AgentRuntime> {
    if (command.type === "runtime.initialize" || command.type === "workspace.open") {
      const agentDir = resolveAgentDirectory(
        command.type === "runtime.initialize" ? command.payload.agentDir : undefined
      );
      const workspace = this.workspaces.register(state.record.context.workspaceId, {
        cwd: command.payload.cwd,
        agentDir,
        trust: command.payload.trust,
        approvalMode: command.payload.approvalMode,
        ...(process.env.PI67_SESSION_CATALOG_DIR === undefined
          ? {}
          : { sessionCatalogDirectory: process.env.PI67_SESSION_CATALOG_DIR }),
        ...(process.env.PI67_STORAGE_ROOT === undefined
          ? {}
          : { storageRoot: process.env.PI67_STORAGE_ROOT })
      });
      state.record.workspaceServices = workspace.workspaceServices;
      return this.loadRuntime(state, workspace.workspaceServices);
    }
    const workspaceServices = state.record.workspaceServices
      ?? this.workspaces.get(state.record.context.workspaceId)?.workspaceServices;
    if (!workspaceServices && !this.options.usesCompatibilityRuntime()) throw runtimeNotReady();
    const runtime = await this.loadRuntime(state, workspaceServices);
    if (!state.record.initialized) {
      const workspace = this.workspaces.get(state.record.context.workspaceId);
      if (workspace) {
        if (process.env.PI67_DEBUG_AGENT_STDERR === "1") {
          process.stderr.write(`[agent-host:init-trigger] ${JSON.stringify({
            commandType: command.type,
            taskId: state.record.context.taskId,
            taskGeneration: state.record.context.taskGeneration,
            hasSessionAuthority: state.record.context.sessionId !== undefined
          })}\n`);
        }
        await this.initializeRuntime(state, runtime, {
          ...workspace.initialization,
          ...(command.type === "session.create"
            ? { creationId: command.payload.creationId }
            : {})
        });
      }
      else if (!this.options.usesCompatibilityRuntime()) throw runtimeNotReady();
    }
    return runtime;
  }

  loadRuntime(
    state: TaskHostState,
    workspaceServices = state.record.workspaceServices
  ): Promise<AgentRuntime> {
    if (this.options.isShuttingDown()) return Promise.reject(connectionClosed());
    if (!state.record.runtime && this.options.usesCompatibilityRuntime()) {
      const compatibilityRuntime = this.options.takeCompatibilityRuntime();
      if (compatibilityRuntime) {
        this.taskRuntimes.adoptCompatibilityRuntime(state.record.context, compatibilityRuntime);
      }
    }
    return this.taskRuntimes.load(state.record.context, workspaceServices);
  }

  projectionRuntime(state: TaskHostState): Promise<AgentRuntime> {
    if (state.record.initialized && state.record.runtime) {
      return Promise.resolve(state.record.runtime);
    }
    if (this.options.usesCompatibilityRuntime()) return this.loadRuntime(state);
    return Promise.reject(runtimeNotReady());
  }

  async closeTask(
    state: TaskHostState,
    mode: "stop" | "dispose"
  ): Promise<CommandResults["task.close"]> {
    const runtimeWasLoaded = state.record.runtime !== undefined || state.record.runtimeLoad !== undefined;
    if (mode === "dispose" && state.operations?.hasActive()) {
      throw new HostCommandError(
        "BUSY",
        "Stop the running Pi Task before disposing it.",
        true
      );
    }
    state.scheduler?.shutdown();
    if (mode === "stop") {
      state.record.runtime?.cancelInteractiveRequests("runtime-dispose");
      await state.operations?.shutdown(
        "Cancelled because the Task was closed.",
        this.options.abortWatchdogMs
      );
    }
    await this.taskRuntimes.disposeTask(state.record.context);
    this.tasks.releaseTaskRun(state.record.taskKey);
    try {
      await this.sessionWriterLeases.releaseTask(state.record.taskKey);
    } finally {
      this.tasks.clearActiveTask(state.record.taskKey);
    }
    return { closed: true, stopped: mode === "stop" && runtimeWasLoaded };
  }

  async reserveWriterTransition(
    state: TaskHostState,
    command: AgentCommand
  ): Promise<SessionWriterLeaseReservation | undefined> {
    const targetPath = command.type === "runtime.initialize"
      ? command.payload.sessionPath
      : command.type === "session.open" ? command.payload.path : undefined;
    return targetPath === undefined
      ? undefined
      : this.sessionWriterLeases.reserve(state.record.taskKey, targetPath);
  }

  cancelWriterTransition(reservation: SessionWriterLeaseReservation): Promise<void> {
    return this.sessionWriterLeases.cancel(reservation);
  }

  async cancelWriterTransitionAfterFailure(
    reservation: SessionWriterLeaseReservation | undefined,
    failure: unknown
  ): Promise<unknown> {
    if (!reservation) return failure;
    try {
      await this.cancelWriterTransition(reservation);
      return failure;
    } catch (cleanupError) {
      return cleanupError;
    }
  }

  async disposeAllForShutdown(onError: (error: unknown) => void): Promise<boolean> {
    try {
      await this.taskRuntimes.disposeAll();
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  async releaseWriterLeasesForShutdown(
    runtimesDisposed: boolean,
    onError: (error: unknown) => void
  ): Promise<void> {
    if (!runtimesDisposed) return;
    await this.sessionWriterLeases.disposeAll().catch(onError);
  }

  async commitWriterTransition(
    state: TaskHostState,
    runtime: AgentRuntime,
    reservation?: SessionWriterLeaseReservation
  ): Promise<void> {
    try {
      const sessionPath = runtime.getIdentity().sessionPath;
      if (reservation) {
        await this.sessionWriterLeases.commit(reservation, sessionPath);
        return;
      }
      if (!sessionPath) return;
      const discovered = await this.sessionWriterLeases.reserve(state.record.taskKey, sessionPath);
      await this.sessionWriterLeases.commit(discovered, sessionPath);
    } catch (error) {
      await this.fenceTaskAfterWriterLeaseFailure(state);
      throw error;
    }
  }

  private async fenceTaskAfterWriterLeaseFailure(state: TaskHostState): Promise<void> {
    state.scheduler?.shutdown();
    try {
      state.record.runtime?.cancelInteractiveRequests("runtime-dispose");
    } catch {
      // Runtime disposal below remains the authoritative writer fence.
    }
    try {
      await this.taskRuntimes.disposeTask(state.record.context);
    } catch {
      throw new HostCommandError(
        "RUNTIME_POISONED",
        "The Pi Session writer conflict could not be safely fenced.",
        true,
        { hostReplacementRequired: true, sessionWriterLeaseConflict: true }
      );
    }
    this.tasks.releaseTaskRun(state.record.taskKey);
    try {
      await this.sessionWriterLeases.releaseTask(state.record.taskKey);
    } catch {
      throw new HostCommandError(
        "RUNTIME_POISONED",
        "The Pi Session writer lease failure could not be safely fenced.",
        true,
        { hostReplacementRequired: true, sessionWriterLeaseConflict: true }
      );
    } finally {
      this.tasks.clearActiveTask(state.record.taskKey);
    }
  }
}

function initializationStageDetail(stage: RuntimeInitializationStage): string {
  switch (stage) {
    case "resolve-session": return "正在解析 Pi Session";
    case "dispose-current": return "正在释放旧 Pi Runtime";
    case "create-session": return "正在创建 Pi Session";
    case "reload-configuration": return "正在加载 Pi 配置";
    case "project-snapshot": return "正在同步 Pi Session 状态";
  }
}

export function resolveAgentDirectory(explicit: string | undefined): string {
  const configured = explicit ?? process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

function runtimeNotReady(): HostCommandError {
  return new HostCommandError(
    "RUNTIME_NOT_READY",
    "Initialize the Task Workspace before using its Pi Runtime.",
    true
  );
}

function connectionClosed(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "The Pi runtime service is shutting down.",
    true,
    { shuttingDown: true }
  );
}
