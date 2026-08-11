import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
  SessionManager,
  type AgentSession,
  type SessionEntry
} from "@earendil-works/pi-coding-agent";
import {
  MAX_NATIVE_SUBAGENT_ERROR_CHARS,
  MAX_NATIVE_SUBAGENT_NESTING_DEPTH,
  MAX_NATIVE_SUBAGENT_RESULT_CHARS,
  MAX_NATIVE_SUBAGENT_WAIT_MS,
  RuntimeError,
  isNativeSubagentTerminalState,
  type NativeSubagentLineage,
  type NativeSubagentChangeReason,
  type NativeSubagentMode,
  type NativeSubagentSpawnRequest,
  type NativeSubagentUsage,
  type NativeSubagentView,
  type NativeSubagentWaitResult
} from "@pi67/domain";
import type { NativeSubagentOperations } from "./native-subagent-tools.js";
import {
  NativeSubagentAdmission,
  type NativeSubagentAdmissionLease
} from "./native-subagent-admission.js";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export const SUBAGENT_SESSION_ENTRY_TYPE = "pi67.subagent-session.v1";
export const SUBAGENT_LIFECYCLE_ENTRY_TYPE = "pi67.subagent-lifecycle.v1";

export interface NativeSubagentSessionHandle {
  session: AgentSession;
  dispose(): Promise<void>;
}

export interface NativeSubagentSessionFactoryInput {
  sessionManager: SessionManager;
  lineage: NativeSubagentLineage;
  parentModel: Model<any> | undefined;
  requestedModel?: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
}

interface NativeSubagentCoordinatorOptions {
  admission: NativeSubagentAdmission;
  parentKey: string;
  getAgentDir: () => string;
  createSession: (input: NativeSubagentSessionFactoryInput) => Promise<NativeSubagentSessionHandle>;
  emit: (item: NativeSubagentView, reason: NativeSubagentChangeReason) => void;
  now?: () => number;
  createId?: () => string;
}

interface ChildRecord {
  view: NativeSubagentView;
  sessionManager: SessionManager | undefined;
  active: ChildActivation | undefined;
  lease: NativeSubagentAdmissionLease | undefined;
}

interface ChildActivation {
  activationId: string;
  handle: NativeSubagentSessionHandle;
  unsubscribe: () => void;
  cleanup: Promise<void> | undefined;
}

interface BoundParent {
  session: AgentSession;
  directory: string;
}

interface Waiter {
  ids: readonly string[];
  mode: "first" | "all";
  resolve: (result: NativeSubagentWaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Owns child Pi Sessions beneath one top-level Pi Runtime. */
export class NativeSubagentCoordinator implements NativeSubagentOperations {
  private readonly records = new Map<string, ChildRecord>();
  private readonly waiters = new Set<Waiter>();
  private readonly pendingCleanups = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private parent: BoundParent | undefined;
  private parentGeneration = 0;

  constructor(private readonly options: NativeSubagentCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async bindParent(session: AgentSession): Promise<void> {
    const generation = ++this.parentGeneration;
    this.interruptLive("The parent Pi Session changed before the child settled.");
    this.parent = undefined;
    await this.awaitPendingCleanups();
    this.records.clear();
    const directory = join(
      this.options.getAgentDir(),
      "desktop-subagents",
      safePathSegment(session.sessionId)
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (generation !== this.parentGeneration) {
      throw new RuntimeError("SESSION_CHANGED_EXTERNALLY", "The parent Pi Session changed while native subagents were binding.");
    }
    this.parent = { session, directory };
    this.restore(session.sessionManager.getBranch());
  }

  detachParent(): void {
    this.parentGeneration += 1;
    this.interruptLive("The parent Pi Session is no longer active.");
    this.parent = undefined;
  }

  async dispose(): Promise<void> {
    this.parentGeneration += 1;
    this.interruptLive("The Pi Runtime stopped before the child settled.");
    await this.awaitPendingCleanups();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ items: this.views(waiter.ids), timedOut: true });
    }
    this.waiters.clear();
    this.records.clear();
    this.parent = undefined;
  }

  async spawn(
    request: NativeSubagentSpawnRequest,
    parentChildId?: string,
    parentDepth = 0
  ): Promise<NativeSubagentView> {
    const parent = this.requireParent();
    const parentGeneration = this.parentGeneration;
    const depth = parentDepth + 1;
    if (depth > MAX_NATIVE_SUBAGENT_NESTING_DEPTH) {
      throw new RuntimeError(
        "RESOURCE_LIMIT_EXCEEDED",
        `Native subagent nesting is limited to depth ${MAX_NATIVE_SUBAGENT_NESTING_DEPTH}.`
      );
    }
    if ((request.isolation ?? "shared") === "worktree") {
      throw new RuntimeError(
        "UNSUPPORTED",
        "Native subagent Worktree isolation is not connected to the Electron Main Worktree authority yet.",
        { details: { feature: "native-subagent-worktree" } }
      );
    }

    const runId = this.createId();
    const childId = this.createId();
    const activationId = this.createId();
    const lease = this.options.admission.acquire({
      parentKey: this.options.parentKey,
      runId,
      activationId
    });
    try {
      const childDirectory = join(parent.directory, safePathSegment(childId));
      await mkdir(childDirectory, { recursive: true, mode: 0o700 });
      const sessionManager = createChildSessionManager(
        request.context ?? "fresh",
        parent.session,
        childDirectory,
        childId
      );
      const timestamp = this.now();
      const sessionPath = sessionManager.getSessionFile();
      const inheritedModel = request.model ?? (parent.session.model
        ? { provider: parent.session.model.provider, id: parent.session.model.id }
        : undefined);
      const lineage: NativeSubagentLineage = {
        runId,
        childId,
        activationId,
        ...(parentChildId === undefined ? {} : { parentChildId }),
        depth,
        role: request.role ?? "general"
      };
      const view: NativeSubagentView = {
        ...lineage,
        state: "pending",
        mode: request.mode ?? "foreground",
        context: request.context ?? "fresh",
        isolation: "shared",
        ...(inheritedModel === undefined ? {} : { model: inheritedModel }),
        reasoning: request.reasoning ?? parent.session.thinkingLevel,
        cwd: sessionManager.getCwd(),
        ...(sessionPath === undefined ? {} : { sessionPath }),
        updatedAt: timestamp
      };
      sessionManager.appendCustomEntry(SUBAGENT_SESSION_ENTRY_TYPE, view);
      const record: ChildRecord = {
        view,
        sessionManager,
        active: undefined,
        lease
      };
      this.records.set(runId, record);
      this.appendParentEntry(SUBAGENT_SESSION_ENTRY_TYPE, view);
      this.publish(record, "spawned");

      const handle = await this.options.createSession({
        sessionManager,
        lineage,
        parentModel: parent.session.model,
        ...(request.model === undefined ? {} : { requestedModel: request.model }),
        thinkingLevel: (request.reasoning ?? parent.session.thinkingLevel) as ThinkingLevel
      });
      if (!this.isCurrentActivation(record, activationId, parent, parentGeneration)) {
        await handle.dispose().catch(() => undefined);
        throw new RuntimeError(
          "SESSION_CHANGED_EXTERNALLY",
          "The parent Pi Session changed before the native subagent became active."
        );
      }
      const activation: ChildActivation = {
        activationId,
        handle,
        unsubscribe: () => undefined,
        cleanup: undefined
      };
      activation.unsubscribe = handle.session.subscribe(() => {
        if (!this.isCurrentActivation(record, activationId, parent, parentGeneration)) return;
        record.view = {
          ...record.view,
          usage: collectUsage(handle.session),
          updatedAt: this.nextTimestamp(record)
        };
      });
      record.active = activation;
      void this.execute(record, activation, rolePrompt(record.view.role, request.task), "started");
      return cloneView(record.view);
    } catch (error) {
      this.options.admission.release(lease);
      const record = this.records.get(runId);
      if (record) this.settle(record, activationId, "failed", "failed", undefined, errorText(error));
      else this.records.delete(runId);
      throw error;
    }
  }

  list(): NativeSubagentView[] {
    return [...this.records.values()]
      .map((record) => cloneView(record.view))
      .sort((left, right) => left.updatedAt - right.updatedAt);
  }

  status(id: string): NativeSubagentView {
    return cloneView(this.requireRecord(id).view);
  }

  async steer(id: string, text: string): Promise<NativeSubagentView> {
    const record = this.requireLiveRecord(id);
    const activation = record.active;
    const session = activation?.handle.session;
    if (!session) throw new RuntimeError("RUNTIME_NOT_READY", "The child Pi Session is not active.");
    await session.steer(text);
    if (record.active !== activation || record.view.activationId !== activation.activationId
      || isNativeSubagentTerminalState(record.view.state)) {
      throw new RuntimeError(
        "SESSION_CHANGED_EXTERNALLY",
        "The native subagent activation changed before the steer request settled."
      );
    }
    record.view = { ...record.view, state: "waiting", updatedAt: this.nextTimestamp(record) };
    this.persist(record);
    this.publish(record, "steered");
    return cloneView(record.view);
  }

  async stop(id: string): Promise<NativeSubagentView> {
    const record = this.requireRecord(id);
    if (isNativeSubagentTerminalState(record.view.state)) return cloneView(record.view);
    const activationId = record.view.activationId;
    const activation = record.active;
    this.settle(record, activationId, "cancelled", "stopped", undefined, "Stopped by the parent Task.");
    if (activation) await this.cleanupActivation(record, activation, true);
    return cloneView(record.view);
  }

  async resume(id: string, mode?: NativeSubagentMode): Promise<NativeSubagentView> {
    const parent = this.requireParent();
    const parentGeneration = this.parentGeneration;
    const record = this.requireRecord(id);
    if (!isNativeSubagentTerminalState(record.view.state)) {
      throw new RuntimeError("BUSY", "The native subagent is still active.", { details: { retryable: true } });
    }
    if (record.view.state === "completed") {
      throw new RuntimeError("INVALID_PAYLOAD", "A completed native subagent does not need to be resumed.");
    }
    const sessionPath = record.view.sessionPath;
    if (!sessionPath) throw new RuntimeError("RUNTIME_NOT_READY", "The child Pi Session file is unavailable.");
    const activationId = this.createId();
    const lease = this.options.admission.acquire({
      parentKey: this.options.parentKey,
      runId: record.view.runId,
      activationId
    });
    try {
      if (record.active) await this.cleanupActivation(record, record.active, true);
      if (this.parent !== parent || this.parentGeneration !== parentGeneration) {
        throw new RuntimeError(
          "SESSION_CHANGED_EXTERNALLY",
          "The parent Pi Session changed before the native subagent could resume."
        );
      }
      const sessionManager = SessionManager.open(sessionPath, dirname(sessionPath));
      const lineage: NativeSubagentLineage = {
        runId: record.view.runId,
        childId: record.view.childId,
        activationId,
        ...(record.view.parentChildId === undefined ? {} : { parentChildId: record.view.parentChildId }),
        depth: record.view.depth,
        role: record.view.role
      };
      const previousView = { ...record.view };
      delete previousView.settledAt;
      delete previousView.result;
      delete previousView.error;
      record.view = {
        ...previousView,
        ...lineage,
        state: "pending",
        mode: mode ?? record.view.mode,
        updatedAt: this.nextTimestamp(record)
      };
      record.sessionManager = sessionManager;
      record.lease = lease;
      this.persist(record);
      this.publish(record, "resumed");
      const requestedModel = record.view.model;
      const handle = await this.options.createSession({
        sessionManager,
        lineage,
        parentModel: parent.session.model,
        ...(requestedModel === undefined ? {} : { requestedModel }),
        thinkingLevel: (record.view.reasoning ?? parent.session.thinkingLevel) as ThinkingLevel
      });
      if (!this.isCurrentActivation(record, activationId, parent, parentGeneration)) {
        await handle.dispose().catch(() => undefined);
        throw new RuntimeError(
          "SESSION_CHANGED_EXTERNALLY",
          "The parent Pi Session changed before the resumed native subagent became active."
        );
      }
      const activation: ChildActivation = {
        activationId,
        handle,
        unsubscribe: () => undefined,
        cleanup: undefined
      };
      activation.unsubscribe = handle.session.subscribe(() => {
        if (!this.isCurrentActivation(record, activationId, parent, parentGeneration)) return;
        record.view = { ...record.view, usage: collectUsage(handle.session), updatedAt: this.nextTimestamp(record) };
      });
      record.active = activation;
      void this.execute(
        record,
        activation,
        "Continue the previously interrupted child task from this Pi JSONL session. Re-check current workspace state before acting.",
        "resumed"
      );
      return cloneView(record.view);
    } catch (error) {
      this.options.admission.release(lease);
      this.settle(record, activationId, "failed", "failed", undefined, errorText(error));
      throw error;
    }
  }

  wait(
    ids: readonly string[],
    mode: "first" | "all" = "all",
    timeoutMs = 30_000
  ): Promise<NativeSubagentWaitResult> {
    const boundedTimeout = Math.max(1_000, Math.min(timeoutMs, MAX_NATIVE_SUBAGENT_WAIT_MS));
    for (const id of ids) this.requireRecord(id);
    if (this.waitSatisfied(ids, mode)) {
      return Promise.resolve({ items: this.views(ids), timedOut: false });
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        ids: [...ids],
        mode,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve({ items: this.views(ids), timedOut: true });
        }, boundedTimeout)
      };
      this.waiters.add(waiter);
    });
  }

  private async execute(
    record: ChildRecord,
    activation: ChildActivation,
    prompt: string,
    startReason: Extract<NativeSubagentChangeReason, "started" | "resumed">
  ): Promise<void> {
    const session = activation.handle.session;
    if (record.active !== activation || record.view.activationId !== activation.activationId) return;
    record.view = {
      ...record.view,
      state: "running",
      startedAt: record.view.startedAt ?? this.now(),
      updatedAt: this.nextTimestamp(record)
    };
    this.persist(record);
    this.publish(record, startReason);
    try {
      await session.prompt(prompt);
      this.settle(
        record,
        activation.activationId,
        "completed",
        "completed",
        lastAssistantText(session),
        undefined
      );
    } catch (error) {
      this.settle(record, activation.activationId, "failed", "failed", undefined, errorText(error));
    } finally {
      await this.cleanupActivation(record, activation, false);
    }
  }

  private settle(
    record: ChildRecord,
    activationId: string,
    state: Extract<NativeSubagentView["state"], "completed" | "failed" | "cancelled" | "interrupted">,
    reason: Extract<NativeSubagentChangeReason, "completed" | "failed" | "stopped" | "interrupted">,
    result?: string,
    error?: string
  ): void {
    if (record.view.activationId !== activationId) return;
    if (isNativeSubagentTerminalState(record.view.state)) return;
    const timestamp = this.nextTimestamp(record);
    const usage = record.active?.activationId === activationId
      ? collectUsage(record.active.handle.session)
      : record.view.usage;
    record.view = {
      ...record.view,
      state,
      updatedAt: timestamp,
      settledAt: timestamp,
      ...(usage === undefined ? {} : { usage }),
      ...(result === undefined ? {} : { result: result.slice(0, MAX_NATIVE_SUBAGENT_RESULT_CHARS) }),
      ...(error === undefined ? {} : { error: error.slice(0, MAX_NATIVE_SUBAGENT_ERROR_CHARS) })
    };
    this.persist(record);
    if (record.lease) this.options.admission.release(record.lease);
    record.lease = undefined;
    this.publish(record, reason);
    this.notifyWaiters();
  }

  private restore(entries: readonly SessionEntry[]): void {
    for (const entry of entries) {
      if (entry.type !== "custom") continue;
      if (entry.customType !== SUBAGENT_SESSION_ENTRY_TYPE && entry.customType !== SUBAGENT_LIFECYCLE_ENTRY_TYPE) continue;
      const view = parsePersistedView(entry.data);
      if (!view) continue;
      this.records.set(view.runId, {
        view,
        sessionManager: undefined,
        active: undefined,
        lease: undefined
      });
    }
    for (const record of this.records.values()) {
      if (!isNativeSubagentTerminalState(record.view.state)) {
        const timestamp = this.nextTimestamp(record);
        record.view = {
          ...record.view,
          state: "interrupted",
          updatedAt: timestamp,
          settledAt: timestamp,
          error: "The Agent Host restarted before this child reached a terminal state."
        };
        this.persist(record);
        this.publish(record, "interrupted");
      } else {
        this.publish(record, "recovered");
      }
    }
  }

  private interruptLive(message: string): void {
    for (const record of this.records.values()) {
      if (!isNativeSubagentTerminalState(record.view.state)) {
        this.settle(record, record.view.activationId, "interrupted", "interrupted", undefined, message);
      }
      if (record.active) void this.cleanupActivation(record, record.active, true);
    }
  }

  private cleanupActivation(
    record: ChildRecord,
    activation: ChildActivation,
    abort: boolean
  ): Promise<void> {
    if (!activation.cleanup) {
      activation.cleanup = (async () => {
        if (abort && activation.handle.session.isStreaming) {
          await activation.handle.session.abort().catch(() => undefined);
        }
        try {
          activation.unsubscribe();
        } catch {
          // Pi subscriptions are best-effort during teardown; handle disposal remains authoritative.
        }
        await activation.handle.dispose().catch(() => undefined);
      })().finally(() => {
        if (record.active === activation) record.active = undefined;
      });
      this.pendingCleanups.add(activation.cleanup);
      void activation.cleanup.then(
        () => this.pendingCleanups.delete(activation.cleanup!),
        () => this.pendingCleanups.delete(activation.cleanup!)
      );
    } else if (abort && activation.handle.session.isStreaming) {
      void activation.handle.session.abort().catch(() => undefined);
    }
    return activation.cleanup;
  }

  private async awaitPendingCleanups(): Promise<void> {
    while (this.pendingCleanups.size > 0) {
      await Promise.all(this.pendingCleanups);
    }
  }

  private isCurrentActivation(
    record: ChildRecord,
    activationId: string,
    parent: BoundParent,
    parentGeneration: number
  ): boolean {
    return this.parent === parent
      && this.parentGeneration === parentGeneration
      && this.records.get(record.view.runId) === record
      && record.view.activationId === activationId
      && !isNativeSubagentTerminalState(record.view.state);
  }

  private nextTimestamp(record: ChildRecord): number {
    return Math.max(this.now(), record.view.updatedAt + 1);
  }

  private persist(record: ChildRecord): void {
    record.sessionManager?.appendCustomEntry(SUBAGENT_LIFECYCLE_ENTRY_TYPE, record.view);
    this.appendParentEntry(SUBAGENT_LIFECYCLE_ENTRY_TYPE, record.view);
  }

  private appendParentEntry(type: string, view: NativeSubagentView): void {
    this.parent?.session.sessionManager.appendCustomEntry(type, view);
  }

  private publish(record: ChildRecord, reason: NativeSubagentChangeReason): void {
    this.options.emit(cloneView(record.view), reason);
  }

  private notifyWaiters(): void {
    for (const waiter of this.waiters) {
      if (!this.waitSatisfied(waiter.ids, waiter.mode)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ items: this.views(waiter.ids), timedOut: false });
    }
  }

  private waitSatisfied(ids: readonly string[], mode: "first" | "all"): boolean {
    const states = ids.map((id) => this.requireRecord(id).view.state);
    return mode === "first"
      ? states.some(isNativeSubagentTerminalState)
      : states.every(isNativeSubagentTerminalState);
  }

  private views(ids: readonly string[]): NativeSubagentView[] {
    return ids.map((id) => cloneView(this.requireRecord(id).view));
  }

  private requireParent(): BoundParent {
    if (!this.parent) throw new RuntimeError("RUNTIME_NOT_READY", "No parent Pi Session is bound for native subagents.");
    return this.parent;
  }

  private requireRecord(id: string): ChildRecord {
    const byRunId = this.records.get(id);
    if (byRunId) return byRunId;
    const byChildId = [...this.records.values()].find((record) => record.view.childId === id);
    if (byChildId) return byChildId;
    throw new RuntimeError("INVALID_PAYLOAD", "The native subagent identity was not found.");
  }

  private requireLiveRecord(id: string): ChildRecord {
    const record = this.requireRecord(id);
    if (isNativeSubagentTerminalState(record.view.state)) {
      throw new RuntimeError("INVALID_PAYLOAD", "The native subagent is no longer active.");
    }
    return record;
  }
}

function createChildSessionManager(
  context: NativeSubagentSpawnRequest["context"],
  parent: AgentSession,
  childDirectory: string,
  childId: string
): SessionManager {
  const parentSession = parent.sessionFile ?? parent.sessionId;
  if (context === "fork") {
    if (!parent.sessionFile) {
      throw new RuntimeError("RUNTIME_NOT_READY", "The parent Pi JSONL must be persisted before a child can fork it.");
    }
    return SessionManager.forkFrom(parent.sessionFile, parent.sessionManager.getCwd(), childDirectory, {
      id: childId,
      parentSession
    });
  }
  return SessionManager.create(parent.sessionManager.getCwd(), childDirectory, {
    id: childId,
    parentSession
  });
}

function rolePrompt(role: NativeSubagentView["role"], task: string): string {
  const roleInstruction = {
    explorer: "Work read-only. Map the narrow requested scope and return concrete path-and-line evidence.",
    worker: "Implement only the bounded requested scope. Preserve unrelated worktree changes and report exact validation.",
    reviewer: "Review read-only for correctness, security, regressions, and missing tests. Lead with actionable findings.",
    general: "Complete the bounded task directly and report the result with decisive evidence."
  }[role];
  return [
    `You are a Pi-67 native ${role} child agent.`,
    roleInstruction,
    "You are not a top-level Desktop Task. Do not reinterpret Browser Profile, Pi Agent Profile, or Worktree as the same concept.",
    "Return a concise final result to the parent agent when done.",
    "",
    "Task:",
    task
  ].join("\n");
}

function lastAssistantText(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
      .slice(0, MAX_NATIVE_SUBAGENT_RESULT_CHARS);
  }
  return "";
}

function collectUsage(session: AgentSession): NativeSubagentUsage {
  const usage: NativeSubagentUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const message of session.messages) {
    if (message.role !== "assistant") continue;
    usage.input += message.usage.input;
    usage.output += message.usage.output;
    usage.cacheRead += message.usage.cacheRead;
    usage.cacheWrite += message.usage.cacheWrite;
    usage.cost += message.usage.cost.total;
  }
  return usage;
}

function parsePersistedView(value: unknown): NativeSubagentView | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role;
  const state = value.state;
  const mode = value.mode;
  const context = value.context;
  const isolation = value.isolation;
  if (
    !isString(value.runId)
    || !isString(value.childId)
    || !isString(value.activationId)
    || !Number.isInteger(value.depth)
    || (value.depth as number) < 1
    || (value.depth as number) > MAX_NATIVE_SUBAGENT_NESTING_DEPTH
    || !["explorer", "worker", "reviewer", "general"].includes(String(role))
    || !["pending", "running", "waiting", "idle", "completed", "failed", "cancelled", "interrupted"].includes(String(state))
    || !["foreground", "background"].includes(String(mode))
    || !["fresh", "fork"].includes(String(context))
    || !["shared", "worktree"].includes(String(isolation))
    || typeof value.updatedAt !== "number"
    || !Number.isFinite(value.updatedAt)
  ) return undefined;
  return value as unknown as NativeSubagentView;
}

function cloneView(view: NativeSubagentView): NativeSubagentView {
  return {
    ...view,
    ...(view.model === undefined ? {} : { model: { ...view.model } }),
    ...(view.usage === undefined ? {} : { usage: { ...view.usage } })
  };
}

function errorText(error: unknown): string {
  return sanitizeRuntimeText(error instanceof Error ? error.message : String(error))
    .slice(0, MAX_NATIVE_SUBAGENT_ERROR_CHARS);
}

function safePathSegment(value: string): string {
  const safe = value.replaceAll(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 128);
  if (!safe) throw new RuntimeError("INVALID_PAYLOAD", "The native subagent identity cannot form a safe path.");
  return safe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}
