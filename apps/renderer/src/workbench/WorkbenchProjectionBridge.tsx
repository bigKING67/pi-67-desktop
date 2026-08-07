import type { OperationView, RuntimeStatus, TaskLifecycle } from "@pi67/domain";
import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../app/app-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionFileIdentity,
  selectSessionId,
  selectSessionName,
  selectSessionPath
} from "../session/session-projection-selectors.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "./workbench-store.js";
import { rendererWorkspaceId } from "./renderer-workspace-identity.js";
import { latestUserMessagePreview } from "./recent-user-message.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

export function WorkbenchProjectionBridge() {
  const workspacePath = useAppStore((state) => state.workspace);
  const trust = useAppStore((state) => state.trust);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionFileIdentity = useSessionProjectionStore(selectSessionFileIdentity);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const sessionPath = useSessionProjectionStore(selectSessionPath);
  const operation = useAppStore((state) => state.operation);
  const runtime = useAppStore((state) => state.runtime);
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
    // Catalog loading is owned by startup registration and Workspace open flows.
    void registerRendererWorkspaceWithHost(descriptor, { queryCatalog: false }).catch((error: unknown) => {
      publishNotification({
        level: "warning",
        title: `无法加载 ${descriptor.displayName} 的会话`,
        message: error instanceof Error ? error.message : "Pi 运行服务暂时无法注册工作区。"
      });
    });
  }, [trust, workspacePath]);

  useEffect(() => {
    if (
      !workspacePath
      || !sessionId
      || !sessionFileIdentity
      || !sessionPath
      || sessionTransitionPending
    ) return;
    const workspaceId = workspaceIdForPath(workspacePath);
    const workbench = rendererWorkbenchStore.getState();
    if (!shouldProjectSession(workbench.tasks, workspaceId, sessionId, sessionFileIdentity, sessionPath)) return;
    const selected = selectedWorkbenchTask(workbench);
    const matchingSession = Object.values(workbench.tasks).find((task) => (
      task.workspaceId === workspaceId && task.sessionFileIdentity === sessionFileIdentity
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
      sessionFileIdentity,
      ...(sessionGeneration === undefined ? {} : { sessionGeneration }),
      ...(operation === undefined ? {} : { operation }),
      runtime,
      ...(recentUserMessagePreview === undefined ? {} : { recentUserMessagePreview }),
      ...(sessionName === undefined ? {} : { sessionName }),
      sessionPath
    });
    const taskId = task.id;
    if (existing) {
      workbench.updateTask(taskId, task);
    } else if (lastProjectedTaskId.current !== taskId) {
      workbench.openTask(task);
    }
    lastProjectedTaskId.current = taskId;
  }, [
    recentUserMessagePreview,
    operation,
    runtime,
    sessionGeneration,
    sessionFileIdentity,
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
  sessionFileIdentity: string;
  sessionGeneration?: number;
  operation?: OperationView;
  runtime: RuntimeStatus;
  recentUserMessagePreview?: string;
  sessionName?: string;
  sessionPath: string;
}

export function workbenchTaskFromProjection({
  existing,
  workspaceId,
  sessionId,
  sessionFileIdentity,
  sessionGeneration,
  operation,
  runtime,
  recentUserMessagePreview,
  sessionName,
  sessionPath
}: WorkbenchTaskProjectionInput): RendererWorkbenchTask {
  const projectionMatchesExistingSession = existing?.sessionId === sessionId
    && existing.sessionFileIdentity === sessionFileIdentity
    && (
      existing.sessionGeneration === undefined
      || sessionGeneration === undefined
      || existing.sessionGeneration === sessionGeneration
    );
  const effectiveUserMessagePreview = projectionMatchesExistingSession
    ? existing.recentUserMessagePreview ?? recentUserMessagePreview
    : recentUserMessagePreview;
  const authoritativeOperation = operation
    && sessionGeneration !== undefined
    && operation.sessionId === sessionId
    && operation.sessionGeneration === sessionGeneration
    ? operation
    : undefined;
  const authoritativeRuntime = authoritativeOperation
    ? runtime
    : { phase: "ready" as const, detail: "Pi SDK 已就绪", recoverable: true };
  return {
    id: existing?.id ?? `session-task:${crypto.randomUUID()}`,
    conversation: { kind: "session", workspaceId, sessionFileIdentity, sessionPath },
    workspaceId,
    sessionId,
    sessionFileIdentity,
    taskGeneration: existing?.taskGeneration ?? 1,
    ...(sessionGeneration === undefined ? {} : { sessionGeneration }),
    lifecycle: taskLifecycle(authoritativeOperation),
    runtime: authoritativeRuntime,
    title: sessionName?.trim() || existing?.title || "未命名任务",
    titleSource: sessionName?.trim() ? "explicit" : existing?.titleSource ?? "fallback",
    ...(effectiveUserMessagePreview
      ? { recentUserMessagePreview: effectiveUserMessagePreview }
      : {}),
    sessionPath,
    hasDraft: existing?.hasDraft ?? false,
    attachmentCount: existing?.attachmentCount ?? 0,
    toolMode: existing?.toolMode ?? "auto",
    operationId: authoritativeOperation?.operationId,
    recoveryHostInstanceId: undefined,
    recoveryHostEpoch: undefined,
    creationId: undefined,
    creationStatus: undefined,
  };
}

export function shouldProjectSession(
  tasks: Record<string, RendererWorkbenchTask>,
  workspaceId: string,
  sessionId: string,
  sessionFileIdentity: string,
  sessionPath?: string
): boolean {
  const physicalOwner = Object.values(tasks).find((task) => (
    task.sessionFileIdentity === sessionFileIdentity
  ));
  if (physicalOwner && (
    physicalOwner.workspaceId !== workspaceId
    || physicalOwner.sessionId !== sessionId
  )) return false;
  if (sessionPath && Object.values(tasks).some((task) => (
    task.workspaceId === workspaceId
    && task.sessionPath === sessionPath
    && task.sessionFileIdentity !== undefined
    && task.sessionFileIdentity !== sessionFileIdentity
  ))) return false;
  return true;
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
