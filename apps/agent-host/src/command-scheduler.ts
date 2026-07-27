import {
  REPLAY_SAFE_CONTROL_MUTATION_TYPES,
  type AgentCommand,
  type AgentCommandType
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export type CommandClass = "exclusive-control" | "recovery" | "turn" | "queue" | "interrupt" | "query";

export interface CommandSchedulerOptions {
  maxConcurrentQueries?: number;
  maxQueuedCommands?: number;
}

export interface CommandSchedulerShutdownResult {
  queuedCommandsDropped: number;
}

const EXCLUSIVE_COMMANDS = new Set<AgentCommandType>([
  ...REPLAY_SAFE_CONTROL_MUTATION_TYPES,
  "session.import",
]);

const QUERY_COMMANDS = new Set<AgentCommandType>([
  "runtime.getStatus",
  "workspace.changes",
  "session.catalog.query",
  "session.tree",
  "message.page",
  "asset.read",
  "model.list",
  "resource.list",
  "command.list",
  "extension.catalog.list",
  "diagnostics.collect",
  "doctor.run"
]);

export function commandClassFor(command: AgentCommand): CommandClass {
  if (EXCLUSIVE_COMMANDS.has(command.type)) return "exclusive-control";
  if (command.type === "projection.resync") return "recovery";
  if (QUERY_COMMANDS.has(command.type)) return "query";
  if (command.type === "prompt.steer" || command.type === "prompt.followUp") return "queue";
  if (command.type === "prompt.submit" && command.payload.delivery !== "new-turn") return "queue";
  if (
    command.type === "operation.abort"
    || command.type === "queue.clear"
    || command.type === "approval.respond"
    || command.type === "extension.ui.respond"
  ) return "interrupt";
  return "turn";
}

export class CommandScheduler {
  private exclusiveTail: Promise<void> = Promise.resolve();
  private exclusiveGeneration = 0;
  private queueTail: Promise<void> = Promise.resolve();
  private queueGeneration = 0;
  private queueAdmitted = 0;
  private queueRunning = false;
  private queueBarriersAdmitted = 0;
  private queueBarrierRunning = false;
  private exclusiveQueued = 0;
  private exclusiveRunning = false;
  private turnAdmission = false;
  private activeQueries = 0;
  private blockingQueries = 0;
  private queriesDrained: Promise<void> = Promise.resolve();
  private resolveQueriesDrained: (() => void) | undefined;
  private readonly maxConcurrentQueries: number;
  private readonly maxQueuedCommands: number;
  private closed = false;
  private shutdownResult: CommandSchedulerShutdownResult | undefined;

  constructor(
    private readonly hasActiveTurn: () => boolean,
    private readonly canAcceptQueue: () => boolean = hasActiveTurn,
    options: CommandSchedulerOptions = {}
  ) {
    this.maxConcurrentQueries = positiveInteger(options.maxConcurrentQueries, 6, "maxConcurrentQueries");
    this.maxQueuedCommands = positiveInteger(options.maxQueuedCommands, 32, "maxQueuedCommands");
  }

  run<T>(command: AgentCommand, task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(connectionClosed());
    const commandClass = commandClassFor(command);
    if (commandClass === "exclusive-control") return this.runExclusive(task);
    if (commandClass === "recovery") return this.runRecovery(task);
    if (commandClass === "interrupt") return task();
    if (commandClass === "query") {
      if ((this.exclusiveRunning || this.exclusiveQueued > 0) && command.type !== "runtime.getStatus") {
        return Promise.reject(busy("A session transition is in progress."));
      }
      return this.runQuery(task, command.type !== "runtime.getStatus");
    }
    if (commandClass === "queue") {
      if (!this.canAcceptQueue()) return Promise.reject(busy("There is no active operation to receive a queued prompt."));
      return this.runQueue(task);
    }
    if (this.exclusiveRunning || this.exclusiveQueued > 0 || this.turnAdmission || this.hasActiveTurn()) {
      return Promise.reject(busy("Another operation is already active."));
    }
    this.turnAdmission = true;
    return task().finally(() => {
      this.turnAdmission = false;
    });
  }

  clearQueue<T>(task: () => Promise<T>): Promise<{ pendingCount: number; result: T }> {
    if (this.closed) return Promise.reject(connectionClosed());
    this.queueGeneration += 1;
    const generation = this.queueGeneration;
    const pendingCount = Math.max(0, this.queueAdmitted - (this.queueRunning ? 1 : 0));
    this.queueBarriersAdmitted += 1;
    const execute = async (): Promise<{ pendingCount: number; result: T }> => {
      if (this.closed || generation !== this.queueGeneration) throw connectionClosed();
      this.queueBarrierRunning = true;
      try {
        return { pendingCount, result: await task() };
      } finally {
        this.queueBarrierRunning = false;
      }
    };
    const cleared = this.queueTail.then(execute, execute);
    void cleared.finally(() => {
      this.queueBarriersAdmitted -= 1;
    }).catch(() => undefined);
    this.queueTail = cleared.then(() => undefined, () => undefined);
    return cleared;
  }

  shutdown(): CommandSchedulerShutdownResult {
    if (this.shutdownResult) return this.shutdownResult;
    this.closed = true;
    this.exclusiveGeneration += 1;
    this.queueGeneration += 1;
    this.shutdownResult = {
      queuedCommandsDropped:
        this.exclusiveQueued
        + Math.max(0, this.queueAdmitted - (this.queueRunning ? 1 : 0))
        + Math.max(0, this.queueBarriersAdmitted - (this.queueBarrierRunning ? 1 : 0))
    };
    return this.shutdownResult;
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const generation = this.exclusiveGeneration;
    this.exclusiveQueued += 1;
    const execute = async (): Promise<T> => {
      if (this.blockingQueries > 0) await this.queriesDrained;
      this.exclusiveQueued -= 1;
      if (this.closed || generation !== this.exclusiveGeneration) throw connectionClosed();
      if (this.hasActiveTurn() || this.turnAdmission) throw busy("An active operation must finish before changing runtime state.");
      this.exclusiveRunning = true;
      try {
        return await task();
      } finally {
        this.exclusiveRunning = false;
      }
    };
    const result = this.exclusiveTail.then(execute, execute);
    this.exclusiveTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private runRecovery<T>(task: () => Promise<T>): Promise<T> {
    const generation = this.exclusiveGeneration;
    this.exclusiveQueued += 1;
    const execute = async (): Promise<T> => {
      if (this.blockingQueries > 0) await this.queriesDrained;
      this.exclusiveQueued -= 1;
      if (this.closed || generation !== this.exclusiveGeneration) throw connectionClosed();
      this.exclusiveRunning = true;
      try {
        return await task();
      } finally {
        this.exclusiveRunning = false;
      }
    };
    const result = this.exclusiveTail.then(execute, execute);
    this.exclusiveTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private runQueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.queueAdmitted >= this.maxQueuedCommands) {
      return Promise.reject(new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many queued prompt commands are already admitted.",
        true,
        { maxQueuedCommands: this.maxQueuedCommands }
      ));
    }
    const generation = this.queueGeneration;
    this.queueAdmitted += 1;
    const execute = async (): Promise<T> => {
      if (this.closed) throw connectionClosed();
      if (generation !== this.queueGeneration) {
        throw new HostCommandError(
          "STALE_OPERATION",
          "The queued prompt was cleared before it reached Pi.",
          true,
          { queueCleared: true }
        );
      }
      this.queueRunning = true;
      try {
        return await task();
      } finally {
        this.queueRunning = false;
      }
    };
    const result = this.queueTail.then(execute, execute).finally(() => {
      this.queueAdmitted -= 1;
    });
    this.queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private runQuery<T>(task: () => Promise<T>, blocksExclusive: boolean): Promise<T> {
    if (this.activeQueries >= this.maxConcurrentQueries) {
      return Promise.reject(busy("Too many Agent Host queries are already running."));
    }
    this.activeQueries += 1;
    if (blocksExclusive) {
      if (this.blockingQueries === 0) {
        this.queriesDrained = new Promise<void>((resolve) => {
          this.resolveQueriesDrained = resolve;
        });
      }
      this.blockingQueries += 1;
    }
    return Promise.resolve()
      .then(task)
      .finally(() => {
        this.activeQueries -= 1;
        if (!blocksExclusive) return;
        this.blockingQueries -= 1;
        if (this.blockingQueries === 0) {
          this.resolveQueriesDrained?.();
          this.resolveQueriesDrained = undefined;
          this.queriesDrained = Promise.resolve();
        }
      });
  }
}

function busy(message: string): HostCommandError {
  return new HostCommandError("BUSY", message, true, { retryable: true });
}

function connectionClosed(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "Agent Host is shutting down.",
    true,
    { shuttingDown: true }
  );
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer.`);
  return resolved;
}
