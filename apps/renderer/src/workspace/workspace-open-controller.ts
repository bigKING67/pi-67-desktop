import {
  DEFAULT_APPROVAL_MODE,
  type WorkspaceDescriptor
} from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ProtocolRequestError } from "@pi67/protocol";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { shouldSuppressAgentHostFollowup } from "../connection/agent-host-startup-state.js";
import {
  invalidateProjectionRecoveryGeneration,
  resynchronizeRendererProjection
} from "../connection/projection-recovery-controller.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { clearConversationAttention } from "../navigation/conversation-attention-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  captureRendererSessionTransition,
  classifyRendererSessionBootstrap,
  type RendererSessionTransitionTarget
} from "../session/session-authority.js";
import { clearedTransientState } from "../app/app-state-projection.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { invalidateWorkspaceTrustRequests } from "./workspace-trust-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  taskForConversation,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { rendererWorkspaceId } from "../workbench/renderer-workspace-identity.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  rendererTaskBelongsToAgentHost,
  rotateRendererTaskForSessionReopen
} from "../workbench/task-runtime-reopen.js";
import {
  preferredWorkspaceSession,
  waitForWorkspaceCatalogDecision,
  workspaceCatalogDecision
} from "./workspace-session-selection.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function openRendererWorkspace(): Promise<void> {
  const system = window.pi67.system;
  const selected = typeof system.pickAndAddWorkspace === "function"
    ? await system.pickAndAddWorkspace()
    : await legacyWorkspaceSelection();
  if (!selected) return;
  rendererWorkbenchStore.getState().registerWorkspace(selected);
  await openRendererWorkspaceDescriptor(selected);
}

export async function selectRendererWorkspaceDescriptor(
  descriptor: WorkspaceDescriptor
): Promise<boolean> {
  if (!validateAvailableWorkspace(descriptor)) return false;
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending || get().workspaceOpenPending) return false;
  const workspace = beginWorkspaceTransition(descriptor, "正在准备工作区");
  try {
    await registerRendererWorkspaceWithHost(descriptor, { queryCatalog: false });
    await ensureAgentConnection();
    if (get().workspace !== workspace) return false;
    set({
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "工作区已就绪，可创建会话", recoverable: true }
    });
    return true;
  } catch (error) {
    if (get().workspace !== workspace) return false;
    const detail = errorMessage(error);
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: `无法准备工作区：${detail}`,
        recoverable: true
      }
    });
    if (!shouldSuppressAgentHostFollowup(error)) {
      publishNotification({ level: "error", title: "无法准备工作区", message: detail });
    }
    return false;
  } finally {
    if (get().workspace === workspace) set({ workspaceOpenPending: false });
  }
}

export async function openRendererWorkspaceDescriptor(
  descriptor: WorkspaceDescriptor,
  sessionPath?: string,
  sessionFileIdentity?: string
): Promise<boolean> {
  if (!validateAvailableWorkspace(descriptor)) return false;
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending || get().workspaceOpenPending) return false;
  const preferredSession = sessionPath
    ? undefined
    : preferredWorkspaceSession(rendererWorkbenchStore.getState(), descriptor.id);
  const workspace = beginWorkspaceTransition(descriptor, "正在加载 Pi SDK");
  let task: RendererWorkbenchTask | undefined;
  let target: RendererSessionTransitionTarget | undefined;
  let runtimeSessionPath = sessionPath;
  let runtimeSessionFileIdentity = sessionFileIdentity;
  let refreshCatalogAfterBootstrap = Boolean(sessionPath);
  try {
    await registerRendererWorkspaceWithHost(descriptor, { queryCatalog: false });
    const connectionIdentity = await ensureAgentConnection();
    if (!runtimeSessionPath) {
      // Catalog IPC may itself time out after the product opening budget. Start it
      // eagerly, then let the bounded store-level decision race its completion.
      void queryFirstSessionCatalog(descriptor.id, { refresh: true }).catch(() => false);
      let decision = workspaceCatalogDecision(descriptor.id, preferredSession);
      if (decision.kind === "pending") {
        decision = await waitForWorkspaceCatalogDecision(descriptor.id, preferredSession);
      }
      if (decision.kind === "pending") {
        set({
          sessionTransitionPending: false,
          runtime: {
            phase: "stopped",
            detail: messages.navigation.catalogTemporarilyUnavailable,
            recoverable: true
          }
        });
        publishNotification({
          level: "warning",
          title: "会话目录尚未就绪",
          message: messages.navigation.catalogTemporarilyUnavailable
        });
        return false;
      }
      if (decision.kind === "session") {
        runtimeSessionPath = decision.target.sessionPath;
        runtimeSessionFileIdentity = decision.target.sessionFileIdentity;
      } else {
        refreshCatalogAfterBootstrap = true;
      }
    }
    task = await ensureWorkspaceRuntimeTask(
      descriptor,
      runtimeSessionPath,
      runtimeSessionFileIdentity,
      connectionIdentity
    );
    const transitionTarget = requireRendererSessionTransition(get());
    target = transitionTarget;
    const acknowledgement = runtimeSessionPath
      ? await agentConnectionController.request(
        "runtime.initialize",
        {
          cwd: workspace,
          sessionPath: runtimeSessionPath,
          trust: descriptor.trust,
          approvalMode: DEFAULT_APPROVAL_MODE
        },
        [],
        { context: workbenchProtocolContextForTask(task) }
      )
      : await agentConnectionController.request(
        "workspace.open",
        {
          cwd: workspace,
          trust: descriptor.trust,
          approvalMode: DEFAULT_APPROVAL_MODE
        },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
    const responseDisposition = classifyRendererSessionBootstrap(
      get(),
      transitionTarget,
      acknowledgement
    );
    const disposition = responseDisposition === "stale"
      && classifyRendererSessionBootstrap(get(), transitionTarget) === "committed"
      ? "committed"
      : responseDisposition;
    if (disposition === "missing-bootstrap") {
      if (runtimeSessionPath) {
        const recovery = await resynchronizeRendererProjection(get, set, {
          hostEpoch: acknowledgement.hostEpoch,
          context: workbenchProtocolContextForTask(task),
          recoveringDetail: "正在同步会话状态",
          readyDetail: "Pi 会话已恢复",
          failureTitle: "无法打开对话"
        });
        if (recovery === "committed") clearOpenedConversationAttention(task.id);
        if (recovery === "failed") {
          rendererWorkbenchStore.getState().updateTask(task.id, {
            lifecycle: "lost",
            runtime: get().runtime
          });
        }
        return recovery === "committed";
      }
      throw new Error("Pi 运行服务未发送 authoritative runtime.ready 事件。");
    }
    if (
      disposition === "committed"
      && refreshCatalogAfterBootstrap
      && get().workspace === workspace
    ) {
      await queryFirstSessionCatalog(descriptor.id, { refresh: true });
    }
    if (disposition === "committed") clearOpenedConversationAttention(task.id);
    return disposition === "committed";
  } catch (error) {
    if (get().workspace !== workspace) return false;
    if (target) {
      const disposition = classifyRendererSessionBootstrap(get(), target);
      if (disposition === "committed") {
        if (refreshCatalogAfterBootstrap) {
          await queryFirstSessionCatalog(descriptor.id, { refresh: true });
        }
        if (task) clearOpenedConversationAttention(task.id);
        return true;
      }
      if (disposition === "stale") return false;
    }
    const missingSession = task !== undefined && Boolean(runtimeSessionPath) && isMissingSessionError(error);
    const detail = missingSession ? "对话记录已不存在" : errorMessage(error);
    const failureTitle = runtimeSessionPath ? "无法打开对话" : "无法打开工作区";
    const runtime = {
      phase: missingSession ? "stopped" as const : "failed" as const,
      detail: missingSession ? detail : `${failureTitle}：${detail}`,
      recoverable: true
    };
    set({
      sessionTransitionPending: false,
      runtime
    });
    if (missingSession && task) {
      const workbench = rendererWorkbenchStore.getState();
      workbench.removeRuntimeTask(task.id);
      workbench.selectWorkspace(descriptor.id);
      publishNotification({
        level: "warning",
        title: "对话记录已不存在",
        message: "该对话可能已被移动或删除，请从左侧选择其他对话。"
      });
    } else {
      if (task) rendererWorkbenchStore.getState().updateTask(task.id, { lifecycle: "lost", runtime });
      if (!shouldSuppressAgentHostFollowup(error)) {
        publishNotification({ level: "error", title: failureTitle, message: detail });
      }
    }
    return false;
  } finally {
    if (get().workspace === workspace) set({ workspaceOpenPending: false });
  }
}

function clearOpenedConversationAttention(taskId: string): void {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (task?.conversation.kind === "session") {
    clearConversationAttention(task.workspaceId, task.conversation.sessionFileIdentity);
  }
}

async function ensureWorkspaceRuntimeTask(
  descriptor: WorkspaceDescriptor,
  sessionPath?: string,
  sessionFileIdentity?: string,
  connectionIdentity?: Awaited<ReturnType<typeof ensureAgentConnection>>
): Promise<RendererWorkbenchTask> {
  const workbench = rendererWorkbenchStore.getState();
  if (sessionPath && sessionFileIdentity) {
    const conversation = {
      kind: "session" as const,
      workspaceId: descriptor.id,
      sessionFileIdentity,
      sessionPath
    };
    const matching = taskForConversation(workbench.tasks, conversation);
    if (matching) {
      if (
        matching.runtime.phase === "stopped"
        || matching.lifecycle === "lost"
        || matching.lifecycle === "stopped"
      ) {
        const replacement = await rotateRendererTaskForSessionReopen(matching, {
          retireCurrentHostTask: connectionIdentity === undefined
            || rendererTaskBelongsToAgentHost(matching, connectionIdentity)
        });
        if (replacement) return replacement;
      }
      workbench.selectTask(matching.id);
      return matching;
    }
    return openWorkspaceRuntimeTask(descriptor, conversation, sessionPath);
  }
  if (sessionPath) return openWorkspaceRuntimeTask(descriptor, undefined, sessionPath);
  const selected = selectedWorkbenchTask(workbench);
  if (selected?.workspaceId === descriptor.id) return selected;

  const existing = [...workbench.runtimeTaskOrder].reverse()
    .map((taskId) => workbench.tasks[taskId])
    .find((task) => task?.workspaceId === descriptor.id);
  if (existing) {
    workbench.selectTask(existing.id);
    return existing;
  }

  return openWorkspaceRuntimeTask(descriptor);
}

function openWorkspaceRuntimeTask(
  descriptor: WorkspaceDescriptor,
  conversation?: RendererWorkbenchTask["conversation"],
  sessionPath?: string
): RendererWorkbenchTask {
  const workbench = rendererWorkbenchStore.getState();
  const taskId = `task-${crypto.randomUUID()}`;
  const task: RendererWorkbenchTask = {
    id: taskId,
    conversation: conversation ?? { kind: "provisional", workspaceId: descriptor.id, draftId: taskId },
    workspaceId: descriptor.id,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: "正在加载 Pi SDK", recoverable: true },
    title: "未命名会话",
    ...(conversation?.kind === "session"
      ? { sessionFileIdentity: conversation.sessionFileIdentity }
      : {}),
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto"
  };
  const opened = workbench.openTask(task);
  if (opened !== "opened" && opened !== "selected") {
    throw new Error("无法为工作区创建会话。");
  }
  return task;
}

function beginWorkspaceTransition(
  descriptor: WorkspaceDescriptor,
  detail: string
): string {
  rendererWorkbenchStore.getState().selectWorkspace(descriptor.id);
  const workspace = descriptor.identity.canonicalPath;
  invalidateProjectionRecoveryGeneration();
  invalidateWorkspaceTrustRequests();
  prepareRendererSessionTransaction("workspace-replaced");
  useAppStore.setState({
    ...clearedTransientState(),
    workspace,
    trust: descriptor.trust,
    trustUpdating: false,
    sessionTransitionPending: true,
    workspaceOpenPending: true,
    approvalMode: DEFAULT_APPROVAL_MODE,
    runtime: { phase: "starting", detail, recoverable: true }
  });
  return workspace;
}

function validateAvailableWorkspace(descriptor: WorkspaceDescriptor): boolean {
  if (descriptor.availability === "available") return true;
  publishNotification({
    level: "warning",
    title: "工作区目录不可用",
    message: descriptor.availability === "identity-changed"
      ? "目录身份已变化，请重新选择并确认工作区目录。"
      : "请重新选择工作区目录后再打开任务。"
  });
  return false;
}

async function legacyWorkspaceSelection(): Promise<WorkspaceDescriptor | undefined> {
  const path = await window.pi67.system.selectWorkspace();
  if (!path) return undefined;
  return {
    id: rendererWorkspaceId(path),
    displayName: basename(path),
    identity: { canonicalPath: path, assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function requireRendererSessionTransition(state: AppState): RendererSessionTransitionTarget {
  const target = captureRendererSessionTransition(state);
  if (!target) throw new Error("Pi 运行服务尚未连接。");
  return target;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function isMissingSessionError(error: unknown): boolean {
  if (error instanceof ProtocolRequestError && error.code === "RESOURCE_NOT_FOUND") return true;
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "ENOENT"
    || /\bENOENT\b|no such file or directory/iu.test(error.message);
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
