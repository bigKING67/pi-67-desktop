import type {
  ConversationKey,
  RuntimeStatus,
  SettingsSection,
  TaskId,
  TaskLifecycle,
  TaskToolMode,
  WorkbenchStateV2,
  WorkbenchSurface,
  WorkspaceDescriptor,
  WorkspaceId
} from "@pi67/domain";

export interface RendererWorkbenchTask {
  id: TaskId;
  conversation: ConversationKey;
  workspaceId: WorkspaceId;
  sessionId: string;
  taskGeneration: number;
  sessionGeneration?: number;
  lifecycle: TaskLifecycle;
  runtime: RuntimeStatus;
  title: string;
  titleSource?: "explicit" | "latest-user" | "fallback";
  pendingTitle?: string | undefined;
  recentUserMessagePreview?: string;
  sessionPath?: string;
  hasDraft: boolean;
  attachmentCount: number;
  toolMode: TaskToolMode;
}

type TaskOpenResult = "opened" | "selected" | "workspace-missing";
type TaskRunAdmission = "allowed" | "run-limit" | "task-missing";

export interface RendererWorkbenchState {
  workspaces: Record<WorkspaceId, WorkspaceDescriptor>;
  workspaceOrder: WorkspaceId[];
  expandedWorkspaceIds: WorkspaceId[];
  currentWorkspaceId: WorkspaceId | undefined;
  tasks: Record<TaskId, RendererWorkbenchTask>;
  runtimeTaskOrder: TaskId[];
  selectedSurface: WorkbenchSurface | undefined;
  settingsReturnSurface: WorkbenchSurface | undefined;
  settingsSection: SettingsSection;
  settingsScope: "global" | "project";
  settingsWorkspaceId: WorkspaceId | undefined;
  hydrate: (state: WorkbenchStateV2) => void;
  registerWorkspace: (workspace: WorkspaceDescriptor) => void;
  unregisterWorkspace: (workspaceId: WorkspaceId) => boolean;
  reorderWorkspaces: (workspaceIds: WorkspaceId[]) => boolean;
  selectWorkspace: (workspaceId: WorkspaceId) => boolean;
  setWorkspaceExpanded: (workspaceId: WorkspaceId, expanded: boolean) => boolean;
  toggleWorkspaceExpanded: (workspaceId: WorkspaceId) => boolean;
  openTask: (task: RendererWorkbenchTask) => TaskOpenResult;
  updateTask: (taskId: TaskId, patch: Partial<RendererWorkbenchTask>) => boolean;
  selectTask: (taskId: TaskId) => boolean;
  selectConversation: (conversation: ConversationKey) => boolean;
  removeRuntimeTask: (taskId: TaskId) => boolean;
  canStartTask: (taskId: TaskId) => TaskRunAdmission;
  openSettings: (section?: SettingsSection) => void;
  selectSettingsSection: (section: SettingsSection) => void;
  setSettingsScope: (scope: "global" | "project") => void;
  closeSettings: () => void;
  reset: () => void;
}
