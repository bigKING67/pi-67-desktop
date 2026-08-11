import {
  NativeSubagentAdmission,
  type AgentRuntime,
  type PiSdkRuntimeOptions,
  type PiWorkspaceRuntimeServices,
  type RuntimeCredentialOverrideStore
} from "@pi67/pi-runtime";
import type { TaskProtocolContext } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import type { PromptAttachmentAccessOwner } from "./prompt-attachment-access.js";

export type TaskRuntimeLoader = (options?: PiSdkRuntimeOptions) => Promise<AgentRuntime>;

export interface TaskRuntimeRecord {
  readonly taskKey: string;
  readonly context: TaskProtocolContext;
  runtime: AgentRuntime | undefined;
  runtimeLoad: Promise<AgentRuntime> | undefined;
  workspaceServices: PiWorkspaceRuntimeServices | undefined;
  initialized: boolean;
  compatibilityRuntime: boolean;
  attachmentCleanupPending: boolean;
  closed: boolean;
}

export interface TaskRuntimeRegistryOptions {
  onRuntimeLoaded?: (record: TaskRuntimeRecord, runtime: AgentRuntime) => void;
}

export class TaskRuntimeRegistry {
  private readonly records = new Map<string, TaskRuntimeRecord>();
  private readonly runtimeOwners = new Map<AgentRuntime, string>();
  private readonly subagentAdmission = new NativeSubagentAdmission();

  constructor(
    private readonly runtimeLoader: TaskRuntimeLoader,
    private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore,
    private readonly options: TaskRuntimeRegistryOptions = {},
    private readonly promptAttachments?: PromptAttachmentAccessOwner
  ) {}

  admit(context: TaskProtocolContext): TaskRuntimeRecord {
    const taskKey = taskRuntimeKey(context.workspaceId, context.taskId);
    const existing = this.records.get(taskKey);
    if (existing) {
      if (
        existing.closed
        && existing.runtime === undefined
        && existing.runtimeLoad === undefined
        && !existing.attachmentCleanupPending
        && context.taskGeneration > existing.context.taskGeneration
      ) {
        this.records.delete(taskKey);
      } else {
        if (existing.context.taskGeneration !== context.taskGeneration) {
          throw new HostCommandError(
            "INVALID_PAYLOAD",
            "The request targets a stale Task generation.",
            false,
            {
              expectedTaskGeneration: existing.context.taskGeneration,
              receivedTaskGeneration: context.taskGeneration
            }
          );
        }
        return existing;
      }
    }
    const record: TaskRuntimeRecord = {
      taskKey,
      context: taskAuthorityBase(context),
      runtime: undefined,
      runtimeLoad: undefined,
      workspaceServices: undefined,
      initialized: false,
      compatibilityRuntime: false,
      attachmentCleanupPending: false,
      closed: false
    };
    this.records.set(taskKey, record);
    return record;
  }

  adoptCompatibilityRuntime(context: TaskProtocolContext, runtime: AgentRuntime): TaskRuntimeRecord {
    const record = this.admit(context);
    if (record.closed) {
      throw new HostCommandError("RUNTIME_NOT_READY", "The Task Runtime has been closed.", true);
    }
    if (record.runtime && record.runtime !== runtime) {
      throw new HostCommandError("INTERNAL", "The Task Runtime has already been loaded.", false);
    }
    this.claimRuntime(record, runtime);
    record.compatibilityRuntime = true;
    return record;
  }

  load(
    context: TaskProtocolContext,
    workspaceServices?: PiWorkspaceRuntimeServices
  ): Promise<AgentRuntime> {
    const record = this.admit(context);
    if (record.closed) {
      return Promise.reject(new HostCommandError(
        "RUNTIME_NOT_READY",
        "The Task Runtime has been closed.",
        true
      ));
    }
    if (record.runtime) {
      this.assertWorkspaceBinding(record, workspaceServices);
      return Promise.resolve(record.runtime);
    }
    if (record.runtimeLoad) return record.runtimeLoad;
    record.workspaceServices = workspaceServices;
    const runtimeOptions: PiSdkRuntimeOptions = {
      runtimeCredentialOverrides: this.runtimeCredentialOverrides,
      subagentAdmission: this.subagentAdmission,
      subagentParentKey: record.taskKey,
      ...(this.promptAttachments === undefined
        ? {}
        : { promptAttachmentAccess: this.promptAttachments.forTask(record.taskKey) }),
      ...(workspaceServices === undefined ? {} : { workspaceServices })
    };
    record.runtimeLoad = this.runtimeLoader(runtimeOptions)
      .then((runtime) => {
        this.claimRuntime(record, runtime);
        return runtime;
      })
      .catch((error: unknown) => {
        record.runtimeLoad = undefined;
        throw error;
      });
    return record.runtimeLoad;
  }

  get(context: TaskProtocolContext): TaskRuntimeRecord | undefined {
    return this.records.get(taskRuntimeKey(context.workspaceId, context.taskId));
  }

  assertSessionAuthority(context: TaskProtocolContext): void {
    if (context.sessionId === undefined) return;
    const runtime = this.get(context)?.runtime;
    if (!runtime) return;
    const current = runtime.getIdentity();
    if (current.sessionGeneration !== context.sessionGeneration) {
      throw new HostCommandError(
        "STALE_SESSION_GENERATION",
        "The request targets a stale Pi Session generation.",
        true,
        {
          expectedSessionGeneration: current.sessionGeneration,
          receivedSessionGeneration: context.sessionGeneration
        }
      );
    }
    if (
      current.sessionId === context.sessionId
      && current.sessionFileIdentity === context.sessionFileIdentity
    ) return;
    throw new HostCommandError(
      "STALE_SESSION_IDENTITY",
      "The request targets a different physical Pi Session.",
      true,
      {
        sessionIdMatches: current.sessionId === context.sessionId,
        sessionFileIdentityMatches:
          current.sessionFileIdentity === context.sessionFileIdentity
      }
    );
  }

  recordsForWorkspace(workspaceId: string): TaskRuntimeRecord[] {
    return [...this.records.values()].filter((record) => record.context.workspaceId === workspaceId);
  }

  values(): TaskRuntimeRecord[] {
    return [...this.records.values()];
  }

  async disposeTask(context: TaskProtocolContext): Promise<boolean> {
    const record = this.admit(context);
    if (record.closed && record.runtime === undefined && record.runtimeLoad === undefined
      && !record.attachmentCleanupPending) return false;
    record.closed = true;
    const runtime = record.runtime ?? await record.runtimeLoad?.catch(() => undefined);
    let disposed = false;
    if (!runtime) {
      record.runtimeLoad = undefined;
      record.initialized = false;
    } else {
      await runtime.dispose();
      this.runtimeOwners.delete(runtime);
      record.runtime = undefined;
      record.runtimeLoad = undefined;
      record.initialized = false;
      disposed = true;
    }
    await this.releaseAttachments(record);
    return disposed;
  }

  async disposeAll(): Promise<void> {
    const records = [...this.records.values()].reverse();
    const disposed = new Set<AgentRuntime>();
    let firstError: unknown;
    for (const record of records) {
      record.closed = true;
      let runtime = record.runtime;
      if (!runtime && record.runtimeLoad) {
        try {
          runtime = await record.runtimeLoad;
        } catch (error) {
          firstError ??= error;
          record.runtimeLoad = undefined;
        }
      }
      let runtimeDisposed = runtime === undefined;
      if (runtime && !disposed.has(runtime)) {
        disposed.add(runtime);
        try {
          await runtime.dispose();
          this.runtimeOwners.delete(runtime);
          record.runtime = undefined;
          record.runtimeLoad = undefined;
          record.initialized = false;
          runtimeDisposed = true;
        } catch (error) {
          firstError ??= error;
        }
      }
      if (!runtimeDisposed) continue;
      try {
        await this.releaseAttachments(record);
        this.records.delete(record.taskKey);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
    this.records.clear();
    this.runtimeOwners.clear();
  }

  private async releaseAttachments(record: TaskRuntimeRecord): Promise<void> {
    record.attachmentCleanupPending = true;
    await this.promptAttachments?.releaseTask(record.taskKey);
    if (record.compatibilityRuntime) await this.promptAttachments?.releaseTask("compatibility");
    record.attachmentCleanupPending = false;
  }

  private claimRuntime(record: TaskRuntimeRecord, runtime: AgentRuntime): void {
    const owner = this.runtimeOwners.get(runtime);
    if (owner && owner !== record.taskKey) {
      throw new HostCommandError(
        "INTERNAL",
        "The Runtime loader returned one Pi Runtime for multiple Tasks.",
        false
      );
    }
    this.runtimeOwners.set(runtime, record.taskKey);
    record.runtime = runtime;
    record.runtimeLoad = undefined;
    this.options.onRuntimeLoaded?.(record, runtime);
  }

  private assertWorkspaceBinding(
    record: TaskRuntimeRecord,
    workspaceServices: PiWorkspaceRuntimeServices | undefined
  ): void {
    if (!workspaceServices || record.workspaceServices === workspaceServices || record.compatibilityRuntime) return;
    throw new HostCommandError(
      "INTERNAL",
      "The Task Runtime was loaded before its Workspace services were available.",
      false
    );
  }
}

function taskRuntimeKey(workspaceId: string, taskId: string): string {
  return JSON.stringify([workspaceId, taskId]);
}

function taskAuthorityBase(context: TaskProtocolContext): TaskProtocolContext {
  return {
    scope: "task",
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    taskGeneration: context.taskGeneration
  };
}
