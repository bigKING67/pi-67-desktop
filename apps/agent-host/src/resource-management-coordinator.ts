import type { AgentRuntime } from "@pi67/pi-runtime";
import { HostCommandError } from "./protocol-error.js";

export interface ResourceManagementTaskView {
  readonly taskKey: string;
  readonly workspaceId: string;
  readonly runtime: AgentRuntime | undefined;
  readonly initialized: boolean;
  isIdle(): boolean;
}

interface ActiveMutation {
  readonly scope: "global" | "project";
  readonly workspaceId: string;
}

export interface ResourceManagementCoordinatorOptions {
  listTasks(): ResourceManagementTaskView[];
  maxConcurrentQueries?: number;
}

export interface ResourceMutationTransaction<T> {
  readonly result: T;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

const DEFAULT_MAX_CONCURRENT_QUERIES = 4;

export class ResourceManagementCoordinator {
  private readonly activeQueries = new Map<string, number>();
  private readonly activeCommands = new Set<Promise<unknown>>();
  private readonly maxConcurrentQueries: number;
  private activeMutation: ActiveMutation | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly options: ResourceManagementCoordinatorOptions) {
    const maximum = options.maxConcurrentQueries ?? DEFAULT_MAX_CONCURRENT_QUERIES;
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError("maxConcurrentQueries must be a positive integer.");
    }
    this.maxConcurrentQueries = maximum;
  }

  runQuery<T>(workspaceId: string, query: () => Promise<T>): Promise<T> {
    this.assertAcceptingCommands();
    this.assertQueryAllowed(workspaceId);
    const active = this.activeQueries.get(workspaceId) ?? 0;
    if (active >= this.maxConcurrentQueries) {
      return Promise.reject(busy("Too many resource management queries are already running."));
    }
    this.activeQueries.set(workspaceId, active + 1);
    return this.trackCommand(Promise.resolve()
      .then(query)
      .finally(() => {
        const remaining = (this.activeQueries.get(workspaceId) ?? 1) - 1;
        if (remaining <= 0) this.activeQueries.delete(workspaceId);
        else this.activeQueries.set(workspaceId, remaining);
      }));
  }

  runMutation<T>(
    workspaceId: string,
    scope: ActiveMutation["scope"],
    operation: () => Promise<T>
  ): Promise<T> {
    return this.runExclusiveMutation(workspaceId, scope, async (affectedTasks) => {
      const result = await operation();
      await reloadAffectedTasks(affectedTasks);
      return result;
    });
  }

  runDeferredReloadMutation<T>(
    workspaceId: string,
    scope: ActiveMutation["scope"],
    operation: () => Promise<T>
  ): Promise<{ result: T; reloadRequired: boolean }> {
    return this.runExclusiveMutation(workspaceId, scope, async (affectedTasks) => {
      const result = await operation();
      const reloadRequired = await reloadIdleAffectedTasks(affectedTasks);
      return { result, reloadRequired };
    }, true);
  }

  runMetadataMutation<T>(
    workspaceId: string,
    scope: ActiveMutation["scope"],
    operation: () => Promise<T>
  ): Promise<T> {
    return this.runExclusiveMutation(workspaceId, scope, () => operation(), true);
  }

  runTransactionalMutation<T>(
    workspaceId: string,
    scope: ActiveMutation["scope"],
    operation: () => Promise<ResourceMutationTransaction<T>>
  ): Promise<T> {
    return this.runExclusiveMutation(workspaceId, scope, async (affectedTasks) => {
      let transaction: ResourceMutationTransaction<T> | undefined;
      try {
        transaction = await operation();
        await reloadAffectedTasks(affectedTasks);
        await transaction.commit();
        return transaction.result;
      } catch (error) {
        if (transaction) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            throw recoveryFailure(
              "rollback",
              "Managed resource mutation failed and its rollback also failed.",
              error,
              rollbackError
            );
          }
          try {
            await reloadAffectedTasks(affectedTasks);
          } catch (restoreReloadError) {
            throw recoveryFailure(
              "reload-restored-resources",
              "Managed resources were rolled back, but Pi Tasks could not reload the restored resources.",
              error,
              restoreReloadError
            );
          }
        }
        throw error;
      }
    });
  }

  assertTaskCommandAllowed(workspaceId: string): void {
    if (!this.activeMutation) return;
    if (this.activeMutation.scope === "project" && this.activeMutation.workspaceId !== workspaceId) return;
    throw busy("Managed resources are being changed for this Task Workspace.");
  }

  shutdown(deadlineMs = 1_000): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10_000) {
      return Promise.reject(new RangeError("Resource shutdown deadline must be between 1 and 10000 milliseconds."));
    }
    this.shuttingDown = true;
    const commands = [...this.activeCommands];
    this.shutdownPromise = commands.length === 0
      ? Promise.resolve()
      : waitForCommands(commands, deadlineMs);
    return this.shutdownPromise;
  }

  private assertQueryAllowed(workspaceId: string): void {
    if (!this.activeMutation) return;
    if (this.activeMutation.scope === "project" && this.activeMutation.workspaceId !== workspaceId) return;
    throw busy("Managed resource settings are being changed for this Workspace.");
  }

  private assertNoConflictingQueries(workspaceId: string, scope: ActiveMutation["scope"]): void {
    const hasQueries = scope === "global"
      ? this.activeQueries.size > 0
      : (this.activeQueries.get(workspaceId) ?? 0) > 0;
    if (hasQueries) throw busy("Wait for managed resource queries to finish before changing resources.");
  }

  private affectedTasks(workspaceId: string, scope: ActiveMutation["scope"]): ResourceManagementTaskView[] {
    return this.options.listTasks().filter((task) => (
      scope === "global" || task.workspaceId === workspaceId
    ));
  }


  private runExclusiveMutation<T>(
    workspaceId: string,
    scope: ActiveMutation["scope"],
    operation: (affectedTasks: ResourceManagementTaskView[]) => Promise<T>,
    allowBusyTasks = false
  ): Promise<T> {
    this.assertAcceptingCommands();
    if (this.activeMutation) throw busy("Another managed resource mutation is already running.");
    this.assertNoConflictingQueries(workspaceId, scope);
    const affectedTasks = this.affectedTasks(workspaceId, scope);
    const busyTask = allowBusyTasks ? undefined : affectedTasks.find((task) => !task.isIdle());
    if (busyTask) {
      throw new HostCommandError(
        "BUSY",
        scope === "global"
          ? "Stop all running or waiting Pi Tasks before changing global managed resources."
          : "Stop running or waiting Pi Tasks in this Workspace before changing managed resources.",
        true,
        { retryable: true, taskKey: busyTask.taskKey, scope }
      );
    }
    this.activeMutation = { scope, workspaceId };
    return this.trackCommand(Promise.resolve()
      .then(() => operation(affectedTasks))
      .finally(() => {
        this.activeMutation = undefined;
      }));
  }

  private assertAcceptingCommands(): void {
    if (this.shuttingDown) {
      throw new HostCommandError(
        "CONNECTION_CLOSED",
        "Managed resource operations are shutting down.",
        true,
        { shuttingDown: true }
      );
    }
  }

  private trackCommand<T>(command: Promise<T>): Promise<T> {
    this.activeCommands.add(command);
    void command.finally(() => this.activeCommands.delete(command)).catch(() => undefined);
    return command;
  }
}

async function waitForCommands(commands: Promise<unknown>[], deadlineMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HostCommandError(
      "RUNTIME_POISONED",
      "Managed resource operations did not settle before shutdown.",
      false,
      { resourceCommandShutdown: false }
    )), deadlineMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.allSettled(commands), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function reloadAffectedTasks(tasks: ResourceManagementTaskView[]): Promise<void> {
  let firstError: unknown;
  for (const task of tasks) {
    if (!task.initialized || !task.runtime) continue;
    try {
      await task.runtime.reloadResources();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

async function reloadIdleAffectedTasks(tasks: ResourceManagementTaskView[]): Promise<boolean> {
  let firstError: unknown;
  let reloadRequired = false;
  for (const task of tasks) {
    if (!task.isIdle()) {
      reloadRequired = true;
      continue;
    }
    if (!task.initialized || !task.runtime) continue;
    try {
      await task.runtime.reloadResources();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
  return reloadRequired;
}

function busy(message: string): HostCommandError {
  return new HostCommandError("BUSY", message, true, { retryable: true });
}

function recoveryFailure(
  stage: "rollback" | "reload-restored-resources",
  message: string,
  operationError: unknown,
  recoveryError: unknown
): HostCommandError {
  return new HostCommandError(
    "RUNTIME_POISONED",
    message,
    false,
    { recoveryStage: stage, resourceStateConsistent: false },
    { cause: new AggregateError([operationError, recoveryError], message) }
  );
}
