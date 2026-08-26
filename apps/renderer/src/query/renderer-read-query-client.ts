import type {
  AgentConnectionIdentity,
  CommandPayloads,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";

export type RendererReadCommand =
  | "session.catalog.query"
  | "session.catalog.contentSearch";

type RendererReadQueryStatus =
  | "loading"
  | "refreshing"
  | "ready"
  | "unavailable"
  | "error";

export interface RendererReadQueryRequest<T extends RendererReadCommand> {
  key: string;
  command: T;
  payload: CommandPayloads[T];
  context: WorkspaceProtocolContext;
}

export interface RendererReadQuerySnapshot<T> {
  status: RendererReadQueryStatus;
  data?: T;
  error?: string;
  updatedAt?: number;
}

export type RendererReadQueryExecute = <T extends RendererReadCommand>(
  command: T,
  payload: CommandPayloads[T],
  context: WorkspaceProtocolContext,
  signal: AbortSignal
) => Promise<CommandResults[T]>;

interface QueryRecord {
  key: string;
  fingerprint: string;
  observers: number;
  generation: number;
  lastReleased: number;
  snapshot: RendererReadQuerySnapshot<unknown>;
  execute: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController | undefined;
  flight: Promise<unknown> | undefined;
}

const DEFAULT_RETAINED_QUERY_COUNT = 64;
const UNAVAILABLE_SNAPSHOT: RendererReadQuerySnapshot<never> = Object.freeze({
  status: "unavailable"
});

export function createRendererReadQueryRequest<T extends RendererReadCommand>(
  command: T,
  payload: CommandPayloads[T],
  context: WorkspaceProtocolContext
): RendererReadQueryRequest<T> {
  const key = JSON.stringify([command, context.workspaceId, payload]);
  return { key, command, payload, context };
}

export class RendererReadQueryClient {
  private readonly records = new Map<string, QueryRecord>();
  private readonly listeners = new Set<() => void>();
  private connection: AgentConnectionIdentity | undefined;
  private version = 0;
  private releaseSequence = 0;

  constructor(
    private readonly execute: RendererReadQueryExecute,
    private readonly retainedQueryCount = DEFAULT_RETAINED_QUERY_COUNT
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getVersion = (): number => this.version;

  connect(identity: AgentConnectionIdentity): void {
    if (sameConnection(this.connection, identity)) return;
    this.connection = identity;
    for (const record of this.records.values()) {
      this.cancelFlight(record);
      if (record.observers > 0) this.run(record, identity);
    }
  }

  disconnect(): void {
    if (this.connection === undefined && !this.hasActiveFlight()) return;
    this.connection = undefined;
    let changed = false;
    for (const record of this.records.values()) {
      if (record.observers === 0) continue;
      this.cancelFlight(record);
      record.snapshot = retainData(record.snapshot, "unavailable");
      changed = true;
    }
    if (changed) this.emit();
  }

  observe<T extends RendererReadCommand>(request: RendererReadQueryRequest<T>): () => void {
    const record = this.ensureRecord(request);
    record.observers += 1;
    if (record.observers === 1) {
      if (this.connection) {
        this.run(record, this.connection);
      } else {
        record.snapshot = retainData(record.snapshot, "unavailable");
        this.emit();
      }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      record.observers = Math.max(0, record.observers - 1);
      if (record.observers > 0) return;
      this.cancelFlight(record);
      record.snapshot = retainData(record.snapshot, "unavailable");
      record.lastReleased = ++this.releaseSequence;
      this.trimRetainedRecords();
      this.emit();
    };
  }

  snapshot<T extends RendererReadCommand>(
    request: RendererReadQueryRequest<T>,
    observedVersion = this.version
  ): RendererReadQuerySnapshot<CommandResults[T]> {
    if (observedVersion > this.version) {
      throw new Error("Renderer read query snapshot revision is ahead of the query client.");
    }
    const record = this.records.get(request.key);
    return (record?.snapshot ?? UNAVAILABLE_SNAPSHOT) as RendererReadQuerySnapshot<CommandResults[T]>;
  }

  refresh(key?: string): void {
    if (!this.connection) return;
    for (const record of this.records.values()) {
      if (record.observers === 0 || (key !== undefined && record.key !== key)) continue;
      this.run(record, this.connection);
    }
  }

  private ensureRecord<T extends RendererReadCommand>(
    request: RendererReadQueryRequest<T>
  ): QueryRecord {
    const fingerprint = JSON.stringify([request.command, request.context, request.payload]);
    const current = this.records.get(request.key);
    if (current) {
      if (current.fingerprint !== fingerprint) {
        throw new Error("Renderer read query key does not uniquely identify its request.");
      }
      return current;
    }
    const record: QueryRecord = {
      key: request.key,
      fingerprint,
      observers: 0,
      generation: 0,
      lastReleased: 0,
      snapshot: UNAVAILABLE_SNAPSHOT,
      controller: undefined,
      flight: undefined,
      execute: (signal) => this.execute(request.command, request.payload, request.context, signal)
    };
    this.records.set(request.key, record);
    return record;
  }

  private run(record: QueryRecord, identity: AgentConnectionIdentity): void {
    if (record.flight || record.observers === 0 || !sameConnection(this.connection, identity)) return;
    const generation = ++record.generation;
    const controller = new AbortController();
    record.controller = controller;
    record.snapshot = retainData(
      record.snapshot,
      record.snapshot.data === undefined ? "loading" : "refreshing"
    );
    this.emit();
    const flight = record.execute(controller.signal);
    record.flight = flight;
    void flight.then((data) => {
      if (!this.isCurrent(record, generation, identity, controller)) return;
      record.snapshot = { status: "ready", data, updatedAt: Date.now() };
      this.emit();
    }).catch(() => {
      if (!this.isCurrent(record, generation, identity, controller)) return;
      record.snapshot = {
        ...retainData(record.snapshot, "error"),
        error: readQueryError(record.key)
      };
      this.emit();
    }).finally(() => {
      if (record.generation !== generation) return;
      record.controller = undefined;
      record.flight = undefined;
    });
  }

  private isCurrent(
    record: QueryRecord,
    generation: number,
    identity: AgentConnectionIdentity,
    controller: AbortController
  ): boolean {
    return record.generation === generation
      && !controller.signal.aborted
      && record.observers > 0
      && sameConnection(this.connection, identity);
  }

  private cancelFlight(record: QueryRecord): void {
    if (!record.controller && !record.flight) return;
    record.generation += 1;
    record.controller?.abort();
    record.controller = undefined;
    record.flight = undefined;
  }

  private hasActiveFlight(): boolean {
    for (const record of this.records.values()) {
      if (record.flight) return true;
    }
    return false;
  }

  private trimRetainedRecords(): void {
    const idle = [...this.records.values()]
      .filter((record) => record.observers === 0)
      .sort((left, right) => left.lastReleased - right.lastReleased);
    while (idle.length > this.retainedQueryCount) {
      const record = idle.shift();
      if (record) this.records.delete(record.key);
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

function retainData(
  current: RendererReadQuerySnapshot<unknown>,
  status: RendererReadQueryStatus
): RendererReadQuerySnapshot<unknown> {
  return {
    status,
    ...(current.data === undefined ? {} : { data: current.data }),
    ...(current.updatedAt === undefined ? {} : { updatedAt: current.updatedAt })
  };
}

function sameConnection(
  left: AgentConnectionIdentity | undefined,
  right: AgentConnectionIdentity | undefined
): boolean {
  return left?.appInstanceId === right?.appInstanceId
    && left?.hostInstanceId === right?.hostInstanceId
    && left?.hostEpoch === right?.hostEpoch;
}

function readQueryError(key: string): string {
  return key.includes("session.catalog.contentSearch")
    ? "对话正文搜索失败。"
    : "Session 目录搜索失败。";
}

export const rendererReadQueryClient = new RendererReadQueryClient(
  (command, payload, context, signal) => agentConnectionController.request(
    command,
    payload,
    [],
    { context, signal }
  )
);
