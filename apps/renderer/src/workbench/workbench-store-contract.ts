import type {
  ConversationKey,
  RuntimeStatus,
  SettingsSection,
  TaskId,
  TaskLifecycle,
  TaskToolMode,
  WorkbenchStateV5,
  WorkbenchSurface,
  WorkspaceDescriptor,
  WorkspaceId
} from "@pi67/domain";
import type { WorktreeCreationProgressState } from "@pi67/protocol";

export type RendererTaskEnvironmentIntent = "local" | "worktree";
type RendererTaskEnvironmentCreationState =
  | "creating"
  | WorktreeCreationProgressState
  | "failed"
  | "recovery-required";

export interface RendererWorkbenchTask {
  id: TaskId;
  conversation: ConversationKey;
  workspaceId: WorkspaceId;
  sessionId: string;
  taskGeneration: number;
  sessionGeneration?: number;
  sessionFileIdentity?: string;
  lifecycle: TaskLifecycle;
  runtime: RuntimeStatus;
  title: string;
  titleSource?: "explicit" | "generated" | "seed" | "fallback";
  pendingTitle?: string | undefined;
  recentUserMessagePreview?: string;
  sessionPath?: string;
  hasDraft: boolean;
  attachmentCount: number;
  toolMode: TaskToolMode;
  operationId?: string | undefined;
  creationId?: string | undefined;
  creationStatus?: "pending" | "confirming" | "unconfirmed" | undefined;
  environmentIntent?: RendererTaskEnvironmentIntent | undefined;
  environmentCreationId?: string | undefined;
  environmentSourceWorkspaceId?: WorkspaceId | undefined;
  environmentCreationState?: RendererTaskEnvironmentCreationState | undefined;
  sessionMetadataStatus?: "indexing" | undefined;
  recoveryHostInstanceId?: string | undefined;
  recoveryHostEpoch?: number | undefined;
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
  hydrate: (state: WorkbenchStateV5) => void;
  registerWorkspace: (workspace: WorkspaceDescriptor) => void;
  unregisterWorkspace: (workspaceId: WorkspaceId) => boolean;
  reorderWorkspaces: (workspaceIds: WorkspaceId[]) => boolean;
  selectWorkspace: (workspaceId: WorkspaceId) => boolean;
  setWorkspaceExpanded: (workspaceId: WorkspaceId, expanded: boolean) => boolean;
  toggleWorkspaceExpanded: (workspaceId: WorkspaceId) => boolean;
  openTask: (task: RendererWorkbenchTask) => TaskOpenResult;
  restoreTask: (task: RendererWorkbenchTask) => TaskId | undefined;
  transferProvisionalTaskToWorkspace: (
    taskId: TaskId,
    workspace: WorkspaceDescriptor
  ) => boolean;
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
