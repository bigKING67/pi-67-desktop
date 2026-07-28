import type { OperationView, RuntimeStatus, TaskLifecycle } from "@pi67/domain";
import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../app/app-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId,
  selectSessionName,
  selectSessionPath
} from "../session/session-projection-selectors.js";
import {
  rendererWorkbenchStore,
  rendererWorkspaceId,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "./workbench-store.js";
import { latestUserMessagePreview } from "./recent-user-message.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

export function WorkbenchProjectionBridge() {
  const workspacePath = useAppStore((state) => state.workspace);
  const trust = useAppStore((state) => state.trust);
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const sessionPath = useSessionProjectionStore(selectSessionPath);
  const conversationAuthority = useConversationStore((state) => state.authority);
  const conversationMessages = useConversationStore((state) => state.messages);
  const recentUserMessagePreview = useMemo(() => {
    if (
      !conversationAuthority
      || conversationAuthority.sessionId !== sessionId
      || conversationAuthority.sessionGeneration !== sessionGeneration
    ) return undefined;
    return latestUserMessagePreview(conversationMessages);
  }, [conversationAuthority, conversationMessages, sessionGeneration, sessionId]);
  const lastProjectedTaskId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!workspacePath) return;
    const workbench = rendererWorkbenchStore.getState();
    const workspaceId = workspaceIdForPath(workspacePath);
    const existing = workbench.workspaces[workspaceId];
    const descriptor = existing
      ? { ...existing, trust }
      : {
          id: workspaceId,
          displayName: basename(workspacePath),
          identity: { canonicalPath: workspacePath, assurance: "path-only" },
          trust,
          trustProvenance: trust === "trusted" ? "native-picker" : "user-confirmed",
          availability: "available"
        } as const;
    workbench.registerWorkspace(descriptor);
    void registerRendererWorkspaceWithHost(descriptor).catch((error: unknown) => {
      publishNotification({
        level: "warning",
        title: `无法加载 ${descriptor.displayName} 的会话`,
        message: error instanceof Error ? error.message : "Pi 运行服务暂时无法注册工作区。"
      });
    });
  }, [trust, workspacePath]);

  useEffect(() => {
    if (!workspacePath || !sessionId || sessionTransitionPending) return;
    const workspaceId = workspaceIdForPath(workspacePath);
    const workbench = rendererWorkbenchStore.getState();
    if (!shouldProjectSession(workbench.tasks, workspaceId, sessionId)) return;
    const selected = selectedWorkbenchTask(workbench);
    const matchingSession = Object.values(workbench.tasks).find((task) => (
      task.workspaceId === workspaceId && task.sessionId === sessionId
    ));
    const provisional = selected?.workspaceId === workspaceId
      && selected.sessionId.startsWith("pending:")
      ? selected
      : undefined;
    const existing = matchingSession ?? provisional;
    const task = workbenchTaskFromProjection({
      ...(existing ? { existing } : {}),
      workspaceId,
      sessionId,
      ...(sessionGeneration === undefined ? {} : { sessionGeneration }),
      ...(operation === undefined ? {} : { operation }),
      runtime,
      ...(recentUserMessagePreview === undefined ? {} : { recentUserMessagePreview }),
      ...(sessionName === undefined ? {} : { sessionName }),
      ...(sessionPath === undefined ? {} : { sessionPath })
    });
    const taskId = task.id;
    if (existing) {
      workbench.updateTask(taskId, task);
    } else if (lastProjectedTaskId.current !== taskId) {
      workbench.openTask(task);
    }
    lastProjectedTaskId.current = taskId;
  }, [
    operation,
    recentUserMessagePreview,
    runtime,
    sessionGeneration,
    sessionId,
    sessionName,
    sessionPath,
    sessionTransitionPending,
    workspacePath
  ]);

  return null;
}

interface WorkbenchTaskProjectionInput {
  existing?: RendererWorkbenchTask;
  workspaceId: string;
  sessionId: string;
  sessionGeneration?: number;
  operation?: OperationView;
  runtime: RuntimeStatus;
  recentUserMessagePreview?: string;
  sessionName?: string;
  sessionPath?: string;
}

export function workbenchTaskFromProjection({
  existing,
  workspaceId,
  sessionId,
  sessionGeneration,
  operation,
  runtime,
  recentUserMessagePreview,
  sessionName,
  sessionPath
}: WorkbenchTaskProjectionInput): RendererWorkbenchTask {
  const effectiveUserMessagePreview = recentUserMessagePreview ?? existing?.recentUserMessagePreview;
  return {
    id: existing?.id ?? `${workspaceId}:${sessionId}`,
    conversation: sessionPath
      ? { kind: "session", workspaceId, sessionPath }
      : existing?.conversation ?? {
          kind: "provisional",
          workspaceId,
          draftId: existing?.id ?? sessionId
        },
    workspaceId,
    sessionId,
    taskGeneration: existing?.taskGeneration ?? 1,
    ...(sessionGeneration === undefined ? {} : { sessionGeneration }),
    lifecycle: taskLifecycle(operation),
    runtime,
    title: sessionName?.trim() || "未命名任务",
    ...(effectiveUserMessagePreview
      ? { recentUserMessagePreview: effectiveUserMessagePreview }
      : {}),
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: existing?.hasDraft ?? false,
    attachmentCount: existing?.attachmentCount ?? 0
  };
}

export function shouldProjectSession(
  tasks: Record<string, RendererWorkbenchTask>,
  workspaceId: string,
  sessionId: string
): boolean {
  const knownOwner = Object.values(tasks).find((task) => task.sessionId === sessionId);
  return knownOwner === undefined || knownOwner.workspaceId === workspaceId;
}

function taskLifecycle(operation: OperationView | undefined): TaskLifecycle {
  if (!operation) return "idle";
  if (operation.activity?.kind === "approval") return "waiting-approval";
  if (operation.activity?.kind === "extension-input") return "waiting-extension-input";
  if (operation.lifecycle === "accepted") return "accepted";
  if (operation.lifecycle === "submitting") return "accepted";
  if (operation.lifecycle === "waiting-input") return "running";
  if (operation.lifecycle === "running") return "running";
  if (operation.lifecycle === "completed") return "completed";
  if (operation.lifecycle === "failed") return "failed";
  if (operation.lifecycle === "cancelled") return "cancelled";
  return "lost";
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function workspaceIdForPath(path: string): string {
  const workbench = rendererWorkbenchStore.getState();
  return Object.values(workbench.workspaces).find((workspace) => (
    workspace.identity.canonicalPath === path
  ))?.id ?? rendererWorkspaceId(path);
}
