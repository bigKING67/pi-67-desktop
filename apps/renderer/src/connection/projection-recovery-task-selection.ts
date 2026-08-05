import type { WorkbenchSurface, WorkspaceId } from "@pi67/domain";
import { suspendRendererWorkbenchPersistence } from "../workbench/workbench-controller.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  taskForConversation
} from "../workbench/workbench-store.js";

export function selectAuthoritativeRecoveryTask(
  recoverySessionPath: string | undefined
): { context: ReturnType<typeof workbenchProtocolContextForTask>; restore(): void } | undefined {
  const workbench = rendererWorkbenchStore.getState();
  const selectedTaskId = selectedWorkbenchTask(workbench)?.id;
  const originalSelection = captureWorkbenchSelection(workbench);
  const task = Object.values(workbench.tasks).find((candidate) => (
    candidate.conversation.kind === "session"
    && candidate.creationStatus === undefined
    && (recoverySessionPath === undefined
      ? candidate.id === selectedTaskId
      : candidate.sessionPath === recoverySessionPath
        || candidate.conversation.sessionPath === recoverySessionPath)
  ));
  if (!task) return undefined;
  const resumePersistence = selectedTaskId === task.id
    ? undefined
    : suspendRendererWorkbenchPersistence();
  if (selectedTaskId !== task.id && !workbench.selectTask(task.id)) {
    resumePersistence?.();
    return undefined;
  }
  let restored = false;
  return {
    context: workbenchProtocolContextForTask(task),
    restore() {
      if (restored) return;
      restored = true;
      const current = rendererWorkbenchStore.getState();
      if (selectedWorkbenchTask(current)?.id === task.id && resumePersistence) {
        const selectedSurface = restoreWorkbenchSurface(
          originalSelection.selectedSurface,
          originalSelection.selectedTaskId,
          current
        );
        rendererWorkbenchStore.setState({
          selectedSurface,
          settingsReturnSurface: restoreWorkbenchSurface(
            originalSelection.settingsReturnSurface,
            originalSelection.settingsReturnTaskId,
            current
          ),
          currentWorkspaceId: workspaceIdForRestoredSelection(
            selectedSurface,
            originalSelection.currentWorkspaceId,
            current
          )
        });
      }
      resumePersistence?.();
    }
  };
}

interface WorkbenchSelectionSnapshot {
  selectedSurface: WorkbenchSurface | undefined;
  selectedTaskId: string | undefined;
  settingsReturnSurface: WorkbenchSurface | undefined;
  settingsReturnTaskId: string | undefined;
  currentWorkspaceId: WorkspaceId | undefined;
}

function captureWorkbenchSelection(
  workbench: ReturnType<typeof rendererWorkbenchStore.getState>
): WorkbenchSelectionSnapshot {
  return {
    selectedSurface: workbench.selectedSurface,
    selectedTaskId: taskIdForSurface(workbench.selectedSurface, workbench),
    settingsReturnSurface: workbench.settingsReturnSurface,
    settingsReturnTaskId: taskIdForSurface(workbench.settingsReturnSurface, workbench),
    currentWorkspaceId: workbench.currentWorkspaceId
  };
}

function taskIdForSurface(
  surface: WorkbenchSurface | undefined,
  workbench: ReturnType<typeof rendererWorkbenchStore.getState>
): string | undefined {
  return surface?.kind === "conversation"
    ? taskForConversation(workbench.tasks, surface.conversation)?.id
    : undefined;
}

function restoreWorkbenchSurface(
  surface: WorkbenchSurface | undefined,
  taskId: string | undefined,
  workbench: ReturnType<typeof rendererWorkbenchStore.getState>
): WorkbenchSurface | undefined {
  if (!surface || surface.kind === "settings") return surface;
  if (surface.kind === "workspace") {
    return workbench.workspaces[surface.workspaceId] ? surface : undefined;
  }
  const task = taskId ? workbench.tasks[taskId] : undefined;
  return task ? { kind: "conversation", conversation: task.conversation } : undefined;
}

function workspaceIdForRestoredSelection(
  surface: WorkbenchSurface | undefined,
  fallback: WorkspaceId | undefined,
  workbench: ReturnType<typeof rendererWorkbenchStore.getState>
): WorkspaceId | undefined {
  if (surface?.kind === "workspace") return surface.workspaceId;
  if (surface?.kind === "conversation") return surface.conversation.workspaceId;
  return fallback && workbench.workspaces[fallback] ? fallback : workbench.workspaceOrder[0];
}
