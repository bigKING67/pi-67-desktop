import {
  MAX_RUNNING_TASKS,
  taskConsumesRunSlot,
  type ConversationKey,
  type RuntimeRecoveryRecord,
  type RuntimeStatus,
  type TaskId,
  type TaskLifecycle,
  type WorkbenchSurface,
  type WorkspaceDescriptor,
  type WorkspaceId
} from "@pi67/domain";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { activateWorkspaceConversation } from "../workspace-files/workspace-file-store.js";
import type {
  RendererWorkbenchState,
  RendererWorkbenchTask
} from "./workbench-store-contract.js";

export type { RendererWorkbenchState, RendererWorkbenchTask } from "./workbench-store-contract.js";

export function createRendererWorkbenchStore() {
  return createStore<RendererWorkbenchState>((set, get) => ({
    ...emptyWorkbenchState(),

    hydrate(state) {
      const workspaces = Object.fromEntries(state.workspaces.map((workspace) => [workspace.id, workspace]));
      const tasks = Object.fromEntries(state.runtimeRecovery.map((record) => {
        const task = taskFromRecovery(record);
        return [task.id, task];
      }));
      const runtimeTaskOrder = state.runtimeRecovery.map((record) => record.taskId);
      const persistedSurface = state.selectedSurface?.kind === "settings"
        ? undefined
        : state.selectedSurface;
      const selectedSurface = isRestorableSurface(persistedSurface, workspaces, tasks)
        ? persistedSurface
        : fallbackSurface(state.currentWorkspaceId, runtimeTaskOrder, tasks);
      const selectedWorkspaceId = workspaceForSurface(selectedSurface);
      const expandedWorkspaceIds = uniqueWorkspaceIds([
        ...state.expandedWorkspaceIds,
        ...(selectedWorkspaceId ? [selectedWorkspaceId] : [])
      ], workspaces);
      set({
        workspaces,
        workspaceOrder: state.workspaceOrder.filter((id) => workspaces[id] !== undefined),
        expandedWorkspaceIds,
        currentWorkspaceId: state.currentWorkspaceId && workspaces[state.currentWorkspaceId]
          ? state.currentWorkspaceId
          : state.workspaceOrder.find((id) => workspaces[id] !== undefined),
        tasks,
        runtimeTaskOrder,
        selectedSurface,
        settingsReturnSurface: undefined,
        settingsSection: state.settings.section,
        settingsScope: state.settings.scope,
        settingsWorkspaceId: state.settings.workspaceId && workspaces[state.settings.workspaceId]
          ? state.settings.workspaceId
          : undefined
      });
    },

    registerWorkspace(workspace) {
      set((current) => ({
        workspaces: { ...current.workspaces, [workspace.id]: workspace },
        workspaceOrder: current.workspaces[workspace.id]
          ? current.workspaceOrder
          : [...current.workspaceOrder, workspace.id],
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(workspace.id)
          ? current.expandedWorkspaceIds
          : [...current.expandedWorkspaceIds, workspace.id],
        currentWorkspaceId: current.currentWorkspaceId ?? workspace.id,
        selectedSurface: current.selectedSurface ?? { kind: "workspace", workspaceId: workspace.id }
      }));
    },

    unregisterWorkspace(workspaceId) {
      const current = get();
      if (!current.workspaces[workspaceId]) return false;
      if (Object.values(current.tasks).some((task) => (
        task.workspaceId === workspaceId
        && (
          task.runtime.phase !== "stopped"
          || task.conversation.kind === "provisional"
          || task.hasDraft
          || task.attachmentCount > 0
        )
      ))) return false;
      const tasks = Object.fromEntries(Object.entries(current.tasks).filter(([, task]) => (
        task.workspaceId !== workspaceId
      )));
      const runtimeTaskOrder = current.runtimeTaskOrder.filter((taskId) => tasks[taskId]);
      const workspaces = { ...current.workspaces };
      delete workspaces[workspaceId];
      const workspaceOrder = current.workspaceOrder.filter((id) => id !== workspaceId);
      const currentWorkspaceId = current.currentWorkspaceId === workspaceId ? workspaceOrder[0] : current.currentWorkspaceId;
      const selectedSurface = workspaceForSurface(current.selectedSurface) === workspaceId
        ? fallbackSurface(currentWorkspaceId, runtimeTaskOrder, tasks)
        : current.selectedSurface;
      const settingsReturnSurface = workspaceForSurface(current.settingsReturnSurface) === workspaceId
        ? undefined
        : current.settingsReturnSurface;
      set({
        workspaces,
        workspaceOrder,
        tasks,
        runtimeTaskOrder,
        expandedWorkspaceIds: current.expandedWorkspaceIds.filter((id) => id !== workspaceId),
        currentWorkspaceId,
        selectedSurface,
        settingsReturnSurface,
        ...(current.settingsWorkspaceId === workspaceId
          ? { settingsScope: "global", settingsWorkspaceId: undefined }
          : {})
      });
      return true;
    },

    reorderWorkspaces(workspaceIds) {
      const current = get();
      if (
        workspaceIds.length !== current.workspaceOrder.length
        || new Set(workspaceIds).size !== workspaceIds.length
        || workspaceIds.some((id) => !current.workspaces[id])
      ) return false;
      set({ workspaceOrder: [...workspaceIds] });
      return true;
    },

    selectWorkspace(workspaceId) {
      const current = get();
      if (!current.workspaces[workspaceId]) return false;
      activateWorkspaceConversation(workspaceId);
      set({
        currentWorkspaceId: workspaceId,
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(workspaceId)
          ? current.expandedWorkspaceIds
          : [...current.expandedWorkspaceIds, workspaceId],
        selectedSurface: current.selectedSurface?.kind === "settings" ? current.selectedSurface : { kind: "workspace", workspaceId },
        settingsReturnSurface: current.selectedSurface?.kind === "settings" ? { kind: "workspace", workspaceId } : current.settingsReturnSurface,
        ...(current.settingsScope === "project" ? { settingsWorkspaceId: workspaceId } : {})
      });
      return true;
    },

    setWorkspaceExpanded(workspaceId, expanded) {
      const current = get();
      if (!current.workspaces[workspaceId]) return false;
      const ids = current.expandedWorkspaceIds.filter((id) => id !== workspaceId);
      set({ expandedWorkspaceIds: expanded ? [...ids, workspaceId] : ids });
      return true;
    },

    toggleWorkspaceExpanded(workspaceId) {
      return get().setWorkspaceExpanded(workspaceId, !get().expandedWorkspaceIds.includes(workspaceId));
    },

    openTask(task) {
      const current = get();
      if (!current.workspaces[task.workspaceId]) return "workspace-missing";
      activateWorkspaceConversation(task.workspaceId);
      const matching = taskForConversation(current.tasks, task.conversation);
      const id = matching?.id ?? task.id;
      const existing = current.tasks[id];
      const nextTask = { ...existing, ...task, id };
      set({
        tasks: { ...current.tasks, [id]: nextTask },
        runtimeTaskOrder: existing ? current.runtimeTaskOrder : [...current.runtimeTaskOrder, id],
        currentWorkspaceId: task.workspaceId,
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(task.workspaceId)
          ? current.expandedWorkspaceIds
          : [...current.expandedWorkspaceIds, task.workspaceId],
        selectedSurface: current.selectedSurface?.kind === "settings" ? current.selectedSurface : { kind: "conversation", conversation: nextTask.conversation },
        settingsReturnSurface: current.selectedSurface?.kind === "settings" ? { kind: "conversation", conversation: nextTask.conversation } : current.settingsReturnSurface
      });
      return existing || matching ? "selected" : "opened";
    },

    updateTask(taskId, patch) {
      const current = get();
      const task = current.tasks[taskId];
      if (!task) return false;
      const next = { ...task, ...patch, id: taskId };
      const taskWasSelected = current.selectedSurface?.kind === "conversation"
        && sameConversation(current.selectedSurface.conversation, task.conversation);
      const taskWasSettingsReturn = current.settingsReturnSurface?.kind === "conversation"
        && sameConversation(current.settingsReturnSurface.conversation, task.conversation);
      set({
        tasks: { ...current.tasks, [taskId]: next },
        ...(taskWasSelected ? {
          selectedSurface: { kind: "conversation" as const, conversation: next.conversation }
        } : {}),
        ...(taskWasSettingsReturn ? {
          settingsReturnSurface: { kind: "conversation" as const, conversation: next.conversation }
        } : {})
      });
      return true;
    },

    selectTask(taskId) {
      const current = get();
      const task = current.tasks[taskId];
      if (!task) return false;
      activateWorkspaceConversation(task.workspaceId);
      set({
        currentWorkspaceId: task.workspaceId,
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(task.workspaceId)
          ? current.expandedWorkspaceIds
          : [...current.expandedWorkspaceIds, task.workspaceId],
        selectedSurface: { kind: "conversation", conversation: task.conversation }
      });
      return true;
    },

    selectConversation(conversation) {
      const current = get();
      if (!current.workspaces[conversation.workspaceId]) return false;
      activateWorkspaceConversation(conversation.workspaceId);
      set({
        currentWorkspaceId: conversation.workspaceId,
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(conversation.workspaceId)
          ? current.expandedWorkspaceIds
          : [...current.expandedWorkspaceIds, conversation.workspaceId],
        selectedSurface: { kind: "conversation", conversation }
      });
      return true;
    },

    removeRuntimeTask(taskId) {
      const current = get();
      const task = current.tasks[taskId];
      if (!task) return false;
      const tasks = { ...current.tasks };
      delete tasks[taskId];
      const selectedSurface = current.selectedSurface?.kind === "conversation"
        && sameConversation(current.selectedSurface.conversation, task.conversation)
        && task.conversation.kind === "provisional"
        ? { kind: "workspace" as const, workspaceId: task.workspaceId }
        : current.selectedSurface;
      set({
        tasks,
        runtimeTaskOrder: current.runtimeTaskOrder.filter((id) => id !== taskId),
        selectedSurface,
        currentWorkspaceId: workspaceForSurface(selectedSurface) ?? current.currentWorkspaceId
      });
      return true;
    },

    canStartTask(taskId) {
      const current = get();
      if (!current.tasks[taskId]) return "task-missing";
      const runningCount = Object.values(current.tasks).filter((task) => (
        task.id !== taskId && taskConsumesRunSlot(task.lifecycle)
      )).length;
      return runningCount >= MAX_RUNNING_TASKS ? "run-limit" : "allowed";
    },

    openSettings(section) {
      const current = get();
      set({
        settingsSection: section ?? current.settingsSection,
        settingsWorkspaceId: current.settingsScope === "project" ? current.currentWorkspaceId : undefined,
        settingsReturnSurface: current.selectedSurface?.kind === "settings"
          ? current.settingsReturnSurface
          : current.selectedSurface,
        selectedSurface: { kind: "settings" }
      });
    },

    selectSettingsSection(settingsSection) {
      set({ settingsSection });
    },

    setSettingsScope(settingsScope) {
      const current = get();
      set({
        settingsScope,
        settingsWorkspaceId: settingsScope === "project" ? current.currentWorkspaceId : undefined
      });
    },

    closeSettings() {
      const current = get();
      const returnSurface = current.settingsReturnSurface
        && current.settingsReturnSurface.kind !== "settings"
        && isRestorableSurface(current.settingsReturnSurface, current.workspaces, current.tasks)
        ? current.settingsReturnSurface
        : fallbackSurface(current.currentWorkspaceId, current.runtimeTaskOrder, current.tasks);
      set({
        selectedSurface: current.selectedSurface?.kind === "settings" ? returnSurface : current.selectedSurface,
        settingsReturnSurface: undefined
      });
    },

    reset() {
      set(emptyWorkbenchState());
    }
  }));
}

export const rendererWorkbenchStore = createRendererWorkbenchStore();

export function useWorkbenchStore<T>(selector: (state: RendererWorkbenchState) => T): T {
  return useStore(rendererWorkbenchStore, selector);
}

export function taskForConversation(
  tasks: Record<TaskId, RendererWorkbenchTask>,
  conversation: ConversationKey
): RendererWorkbenchTask | undefined {
  const identity = rendererConversationIdentity(conversation);
  return Object.values(tasks).find((task) => rendererConversationIdentity(task.conversation) === identity);
}

export function rendererConversationIdentity(conversation: ConversationKey): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${conversation.sessionPath}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}

export function selectedWorkbenchTask(state: RendererWorkbenchState): RendererWorkbenchTask | undefined {
  return state.selectedSurface?.kind === "conversation"
    ? taskForConversation(state.tasks, state.selectedSurface.conversation)
    : undefined;
}

function emptyWorkbenchState() {
  return {
    workspaces: {},
    workspaceOrder: [],
    expandedWorkspaceIds: [],
    currentWorkspaceId: undefined,
    tasks: {},
    runtimeTaskOrder: [],
    selectedSurface: undefined,
    settingsReturnSurface: undefined,
    settingsSection: "general" as const,
    settingsScope: "global" as const,
    settingsWorkspaceId: undefined
  };
}

function taskFromRecovery(record: RuntimeRecoveryRecord): RendererWorkbenchTask {
  return {
    id: record.taskId,
    conversation: record.conversation,
    workspaceId: record.conversation.workspaceId,
    sessionId: record.sessionId,
    taskGeneration: record.taskGeneration,
    sessionGeneration: record.sessionGeneration,
    lifecycle: record.lastKnownLifecycle,
    runtime: stoppedRuntime(record.lastKnownLifecycle),
    title: "未命名会话",
    titleSource: "fallback",
    ...(record.conversation.kind === "session" ? { sessionPath: record.conversation.sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    recoveryHostInstanceId: record.hostInstanceId,
    recoveryHostEpoch: record.hostEpoch
  };
}

function stoppedRuntime(lifecycle: TaskLifecycle): RuntimeStatus {
  const lost = taskConsumesRunSlot(lifecycle);
  return {
    phase: lost ? "failed" : "stopped",
    detail: lost ? "上次运行已中断" : "会话尚未运行",
    recoverable: true
  };
}

function isRestorableSurface(
  surface: WorkbenchSurface | undefined,
  workspaces: Record<WorkspaceId, WorkspaceDescriptor>,
  tasks: Record<TaskId, RendererWorkbenchTask>
): surface is WorkbenchSurface {
  if (!surface) return false;
  if (surface.kind === "settings") return true;
  const workspaceExists = workspaces[workspaceForSurface(surface)!] !== undefined;
  if (!workspaceExists || surface.kind !== "conversation" || surface.conversation.kind === "session") {
    return workspaceExists;
  }
  return taskForConversation(tasks, surface.conversation) !== undefined;
}

function fallbackSurface(
  workspaceId: WorkspaceId | undefined,
  runtimeTaskOrder: TaskId[],
  tasks: Record<TaskId, RendererWorkbenchTask>
): WorkbenchSurface | undefined {
  const sameWorkspaceTask = [...runtimeTaskOrder].reverse().find((id) => tasks[id]?.workspaceId === workspaceId);
  const task = tasks[sameWorkspaceTask ?? [...runtimeTaskOrder].reverse().find((id) => tasks[id] !== undefined) ?? ""];
  if (task) return { kind: "conversation", conversation: task.conversation };
  return workspaceId ? { kind: "workspace", workspaceId } : undefined;
}

function workspaceForSurface(surface: WorkbenchSurface | undefined): WorkspaceId | undefined {
  if (surface?.kind === "workspace") return surface.workspaceId;
  if (surface?.kind === "conversation") return surface.conversation.workspaceId;
  return undefined;
}

function sameConversation(left: ConversationKey, right: ConversationKey): boolean {
  return rendererConversationIdentity(left) === rendererConversationIdentity(right);
}

function uniqueWorkspaceIds(
  ids: readonly WorkspaceId[],
  workspaces: Record<WorkspaceId, WorkspaceDescriptor>
): WorkspaceId[] {
  return [...new Set(ids)].filter((id) => workspaces[id] !== undefined);
}
