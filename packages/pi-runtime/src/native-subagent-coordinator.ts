import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSession,
  type SessionEntry
} from "@earendil-works/pi-coding-agent";
import {
  MAX_NATIVE_SUBAGENT_ERROR_CHARS,
  MAX_NATIVE_SUBAGENT_NESTING_DEPTH,
  MAX_NATIVE_SUBAGENT_RESULT_CHARS,
  RuntimeError,
  isNativeSubagentTerminalState,
  type NativeSubagentChangeReason,
  type NativeSubagentMode,
  type NativeSubagentSpawnRequest,
  type NativeSubagentView,
  type NativeSubagentWaitResult
} from "@pi67/domain";
import type { NativeSubagentOperations } from "./native-subagent-tools.js";
import { NativeSubagentCleanup } from "./native-subagent-cleanup.js";
import {
  cloneView,
  collectUsage,
  createNativeSubagentRecord,
  errorText,
  lastAssistantText,
  parsePersistedView,
  prepareNativeSubagentResume,
  safePathSegment,
  type BoundParent,
  type ChildActivation,
  type ChildRecord,
  type NativeSubagentCoordinatorOptions,
} from "./native-subagent-support.js";
import { NativeSubagentWaiters } from "./native-subagent-waiters.js";

export type {
  NativeSubagentSessionFactoryInput,
  NativeSubagentSessionHandle
} from "./native-subagent-support.js";

export const SUBAGENT_SESSION_ENTRY_TYPE = "pi67.subagent-session.v1";
export const SUBAGENT_LIFECYCLE_ENTRY_TYPE = "pi67.subagent-lifecycle.v1";

/** Owns child Pi Sessions beneath one top-level Pi Runtime. */
export class NativeSubagentCoordinator implements NativeSubagentOperations {
  private readonly records = new Map<string, ChildRecord>();
  private readonly waiters = new NativeSubagentWaiters();
  private readonly cleanup = new NativeSubagentCleanup();
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
    await this.cleanup.settle();
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
    await this.cleanup.settle();
    this.waiters.dispose((id) => this.requireRecord(id));
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
      const timestamp = this.now();
      const prepared = await createNativeSubagentRecord({
        request,
        parent,
        ...(parentChildId === undefined ? {} : { parentChildId }),
        depth,
        runId,
        childId,
        activationId,
        lease,
        timestamp
      });
      const { record } = prepared;
      record.sessionManager!.appendCustomEntry(SUBAGENT_SESSION_ENTRY_TYPE, record.view);
      this.records.set(runId, record);
      this.appendParentEntry(SUBAGENT_SESSION_ENTRY_TYPE, record.view);
      this.publish(record, "spawned");

      const handle = await this.options.createSession(prepared.sessionInput);
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
      void this.execute(record, activation, prepared.prompt, "started");
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
    if (activation) await this.cleanup.cleanup(record, activation, true);
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
    const activationId = this.createId();
    const lease = this.options.admission.acquire({
      parentKey: this.options.parentKey,
      runId: record.view.runId,
      activationId
    });
    try {
      if (record.active) await this.cleanup.cleanup(record, record.active, true);
      if (this.parent !== parent || this.parentGeneration !== parentGeneration) {
        throw new RuntimeError(
          "SESSION_CHANGED_EXTERNALLY",
          "The parent Pi Session changed before the native subagent could resume."
        );
      }
      const sessionInput = prepareNativeSubagentResume({
        record,
        parentModel: parent.session.model,
        parentThinkingLevel: parent.session.thinkingLevel,
        activationId,
        ...(mode === undefined ? {} : { mode }),
        timestamp: this.nextTimestamp(record)
      });
      record.lease = lease;
      this.persist(record);
      this.publish(record, "resumed");
      const handle = await this.options.createSession(sessionInput);
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
    return this.waiters.wait(ids, mode, timeoutMs, (id) => this.requireRecord(id));
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
      await this.cleanup.cleanup(record, activation, false);
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
      if (record.active) void this.cleanup.cleanup(record, record.active, true);
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
    this.waiters.notify((id) => this.requireRecord(id));
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
