import type { WorkspaceDescriptor } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import {
  invalidateProjectionRecoveryGeneration,
  resynchronizeRendererProjection
} from "../connection/projection-recovery-controller.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
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

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function openRendererWorkspace(): Promise<void> {
  const system = window.pi67.system;
  const selected = typeof system.pickAndAddWorkspace === "function"
    ? await system.pickAndAddWorkspace()
    : await legacyWorkspaceSelection();
  if (!selected) return;
  rendererWorkbenchStore.getState().registerWorkspace(selected);
  rendererWorkbenchStore.getState().selectWorkspace(selected.id);
  await registerRendererWorkspaceWithHost(selected, { refreshCatalog: true });
  await openRendererWorkspaceDescriptor(selected);
}

export async function openRendererWorkspaceDescriptor(
  descriptor: WorkspaceDescriptor,
  sessionPath?: string
): Promise<boolean> {
  if (descriptor.availability !== "available") {
    publishNotification({
      level: "warning",
      title: "工作区目录不可用",
      message: descriptor.availability === "identity-changed"
        ? "目录身份已变化，请重新选择并确认工作区目录。"
        : "请重新选择工作区目录后再打开任务。"
    });
    return false;
  }
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending) return false;
  rendererWorkbenchStore.getState().selectWorkspace(descriptor.id);
  const task = ensureWorkspaceRuntimeTask(descriptor, sessionPath);
  const workspace = descriptor.identity.canonicalPath;
  invalidateProjectionRecoveryGeneration();
  invalidateWorkspaceTrustRequests();
  prepareRendererSessionTransaction("workspace-replaced");
  set({
    ...clearedTransientState(),
    workspace,
    trust: descriptor.trust,
    trustUpdating: false,
    sessionTransitionPending: true,
    approvalMode: "guided",
    runtime: { phase: "starting", detail: "正在加载 Pi SDK", recoverable: true }
  });
  let target: RendererSessionTransitionTarget | undefined;
  try {
    await ensureAgentConnection();
    const transitionTarget = requireRendererSessionTransition(get());
    target = transitionTarget;
    const acknowledgement = sessionPath
      ? await agentConnectionController.request(
        "runtime.initialize",
        {
          cwd: workspace,
          sessionPath,
          trust: descriptor.trust,
          approvalMode: "guided"
        },
        [],
        { context: workbenchProtocolContextForTask(task) }
      )
      : await agentConnectionController.request(
        "workspace.open",
        {
          cwd: workspace,
          trust: descriptor.trust,
          approvalMode: "guided"
        },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
    const disposition = classifyRendererSessionBootstrap(
      get(),
      transitionTarget,
      acknowledgement
    );
    if (disposition === "missing-bootstrap") {
      if (sessionPath) {
        const recovery = await resynchronizeRendererProjection(get, set, {
          hostEpoch: acknowledgement.hostEpoch,
          recoveringDetail: "正在同步会话状态",
          readyDetail: "Pi 会话已恢复",
          failureTitle: "无法打开会话"
        });
        return recovery === "committed";
      }
      throw new Error("Pi 运行服务未发送 authoritative runtime.ready 事件。");
    }
    if (disposition === "committed" && get().workspace === workspace) {
      await queryFirstSessionCatalog(descriptor.id);
    }
    return disposition === "committed";
  } catch (error) {
    if (get().workspace !== workspace) return false;
    if (target) {
      const disposition = classifyRendererSessionBootstrap(get(), target);
      if (disposition === "committed") {
        await queryFirstSessionCatalog(descriptor.id);
        return true;
      }
      if (disposition === "stale") return false;
    }
    const detail = errorMessage(error);
    const failureTitle = sessionPath ? "无法打开会话" : "无法打开工作区";
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: `${failureTitle}：${detail}`,
        recoverable: true
      }
    });
    publishNotification({ level: "error", title: failureTitle, message: detail });
    return false;
  }
}

function ensureWorkspaceRuntimeTask(
  descriptor: WorkspaceDescriptor,
  sessionPath?: string
): RendererWorkbenchTask {
  const workbench = rendererWorkbenchStore.getState();
  if (sessionPath) {
    const conversation = { kind: "session" as const, workspaceId: descriptor.id, sessionPath };
    const matching = taskForConversation(workbench.tasks, conversation);
    if (matching) {
      workbench.selectTask(matching.id);
      return matching;
    }
    return openWorkspaceRuntimeTask(descriptor, conversation, sessionPath);
  }
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
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0
  };
  const opened = workbench.openTask(task);
  if (opened !== "opened" && opened !== "selected") {
    throw new Error("无法为工作区创建会话。");
  }
  return task;
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

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
